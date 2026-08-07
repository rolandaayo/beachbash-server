const express = require("express");
const router = express.Router();
const {
  register,
  login,
  logout,
  me,
} = require("../controllers/authController");
const authenticate = require("../middleware/authenticate");

// Public routes
router.post("/register", register);
router.post("/login", login);

// Protected routes (require valid JWT)
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, me);

module.exports = router;
