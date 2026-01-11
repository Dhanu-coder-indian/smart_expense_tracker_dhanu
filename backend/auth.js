const db = require('./db');

module.exports = function (req, res, next) {
  // Read userId from header
  const userId = req.headers['user-id'];

  // If userId not present → not logged in
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: No userId" });
  }

  // Verify user exists in DB
  db.query(
    "SELECT id FROM users WHERE id = ?",
    [userId],
    (err, result) => {
      if (err) {
        return res.status(500).json({ message: "Server error" });
      }

      if (result.length === 0) {
        return res.status(401).json({ message: "Invalid user" });
      }

      // Attach userId to request for next routes
      req.userId = userId;
      next();
    }
  );
};
