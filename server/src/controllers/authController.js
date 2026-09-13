const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../config/prisma");
const { ApiError } = require("../middleware/errorHandler");

const SALT_ROUNDS = 10;

// Letters, digits, underscores only - keeps it safe to display and to type
// into the "add member" field without any quoting/escaping concerns.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const signupSchema = z.object({
  name: z.string().min(1),
  username: z
    .string()
    .regex(USERNAME_RE, "Username must be 3-20 characters: letters, numbers, and underscores only"),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

async function signup(req, res, next) {
  try {
    const { name, username, email, password } = signupSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      throw new ApiError(
        409,
        existing.email === email ? "An account with this email already exists" : "That username is taken"
      );
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { name, username, email, passwordHash },
    });

    const token = generateToken(user.id);
    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, username: user.username, email: user.email },
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new ApiError(401, "Invalid email or password");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError(401, "Invalid email or password");

    const token = generateToken(user.id);
    res.json({
      token,
      user: { id: user.id, name: user.name, username: user.username, email: user.email },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { signup, login };
