const mongoose = require("mongoose");

function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: "Database unavailable. Check MONGO_URI in server/.env",
    });
  }
  next();
}

module.exports = requireDb;
