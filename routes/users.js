const express = require("express");
const router = express.Router();
const adminOnly = require("../middleware/adminOnly");
const {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} = require("../controllers/userController");

// All user management routes require admin secret
router.get("/", adminOnly, listUsers);
router.get("/:id", adminOnly, getUser);
router.post("/", adminOnly, createUser);
router.patch("/:id", adminOnly, updateUser);
router.delete("/:id", adminOnly, deleteUser);

module.exports = router;
