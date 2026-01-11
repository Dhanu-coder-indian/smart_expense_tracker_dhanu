const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

const db = require('./db');
const auth = require('./auth');   // ✅ only ONE auth import

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   REGISTER (PUBLIC)
========================= */
app.post('/register', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Missing email or password" });
  }

  const hash = bcrypt.hashSync(password, 8);

  db.query(
    "INSERT INTO users (email, password) VALUES (?, ?)",
    [email, hash],
    (err) => {
      if (err) {
        return res.status(500).json({ message: "User already exists" });
      }
      res.json({ message: "Registered successfully" });
    }
  );
});

/* =========================
   LOGIN (PUBLIC)
========================= */
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    (err, result) => {
      if (!result.length) {
        return res.status(401).json({ message: "User not found" });
      }

      if (!bcrypt.compareSync(password, result[0].password)) {
        return res.status(401).json({ message: "Wrong password" });
      }

      // ✅ NO JWT — return userId
      res.json({ userId: result[0].id });
    }
  );
});

/* =========================
   ADD EXPENSE (PROTECTED)
========================= */
app.post('/expense', auth, (req, res) => {
  const { amount, category, type, date } = req.body;

  db.query(
    "INSERT INTO expenses (user_id, amount, category, type, created_at) VALUES (?, ?, ?, ?, ?)",
    [req.userId, amount, category, type, date],
    (err) => {
      if (err) return res.status(500).send(err);
      res.send("Expense added");
    }
  );
});


/* =========================
   GET EXPENSES (PROTECTED)
========================= */
app.get('/expenses', auth, (req, res) => {
  db.query(
    "SELECT * FROM expenses WHERE user_id = ?",
    [req.userId],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json(result);
    }
  );
});

/* =========================
   EXPORT CSV (PROTECTED)
========================= */
app.get('/export/csv', auth, (req, res) => {
  db.query(
    "SELECT * FROM expenses WHERE user_id = ?",
    [req.userId],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const parser = new Parser();
      const csv = parser.parse(result);

      res.header("Content-Type", "text/csv");
      res.attachment("expenses.csv");
      res.send(csv);
    }
  );
});

/* =========================
   EXPORT PDF (PROTECTED)
========================= */
app.get('/export/pdf', auth, (req, res) => {
  db.query(
    "SELECT * FROM expenses WHERE user_id = ?",
    [req.userId],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const doc = new PDFDocument();
      res.setHeader("Content-Type", "application/pdf");

      doc.pipe(res);
      doc.fontSize(18).text("Expense Report\n\n");

      result.forEach(exp => {
        doc.fontSize(12).text(
          `${exp.category} | ${exp.type} | ₹${exp.amount} | ${exp.created_at}`
        );
      });

      doc.end();
    }
  );
});

app.delete('/expense/:id', auth, (req, res) => {
  const expenseId = req.params.id;

  db.query(
    "DELETE FROM expenses WHERE id = ? AND user_id = ?",
    [expenseId, req.userId],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send("Expense deleted");
    }
  );
});

app.put('/expense/:id', auth, (req, res) => {
  const expenseId = req.params.id;
  const { amount, category, type } = req.body;

  db.query(
    "UPDATE expenses SET amount=?, category=?, type=? WHERE id=? AND user_id=?",
    [amount, category, type, expenseId, req.userId],
    (err) => {
      if (err) return res.status(500).send(err);
      res.send("Expense updated");
    }
  );
});

app.get('/summary', auth, (req, res) => {
  db.query(
    `
    SELECT
      SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense
    FROM expenses
    WHERE user_id = ?
    `,
    [req.userId],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const income = result[0].income || 0;
      const expense = result[0].expense || 0;

      res.json({
        income,
        expense,
        balance: income - expense
      });
    }
  );
});

app.get('/chart-data', auth, (req, res) => {
  db.query(
    `
    SELECT category, SUM(amount) AS total
    FROM expenses
    WHERE user_id = ? AND type = 'expense'
    GROUP BY category
    `,
    [req.userId],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json(result);
    }
  );
});

app.get('/expenses/by-date/:date', auth, (req, res) => {
  const date = req.params.date;

  db.query(
    `
    SELECT * FROM expenses
    WHERE user_id = ?
    AND DATE(created_at) = ?
    `,
    [req.userId, date],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json(result);
    }
  );
});


app.get('/chart-data/monthly/:month', auth, (req, res) => {
  const month = req.params.month; // YYYY-MM

  db.query(
    `
    SELECT category, SUM(amount) AS total
    FROM expenses
    WHERE user_id = ?
      AND type = 'expense'
      AND DATE_FORMAT(created_at, '%Y-%m') = ?
    GROUP BY category
    `,
    [req.userId, month],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json(result);
    }
  );
});

app.get('/export/pdf/monthly/:month', auth, (req, res) => {
  const month = req.params.month;

  db.query(
    `
    SELECT * FROM expenses
    WHERE user_id = ?
      AND DATE_FORMAT(created_at, '%Y-%m') = ?
    `,
    [req.userId, month],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const doc = new PDFDocument();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=expenses-${month}.pdf`
      );

      doc.pipe(res);

      doc.fontSize(18).text(`Expense Report - ${month}\n\n`);

      let total = 0;

      result.forEach(e => {
        doc.fontSize(12).text(
          `${e.created_at} | ${e.category} | ${e.type} | ₹${e.amount}`
        );
        if (e.type === 'expense') total += e.amount;
      });

      doc.text("\n------------------------");
      doc.fontSize(14).text(`Total Expense: ₹${total}`);

      doc.end();
    }
  );
});

app.get('/monthly-total/:month', auth, (req, res) => {
  const month = req.params.month; // format: YYYY-MM

  db.query(
    `
    SELECT SUM(amount) AS total
    FROM expenses
    WHERE user_id = ?
      AND type = 'expense'
      AND DATE_FORMAT(created_at, '%Y-%m') = ?
    `,
    [req.userId, month],
    (err, result) => {
      if (err) return res.status(500).send(err);

      res.json({
        total: result[0].total || 0
      });
    }
  );
});


app.get('/yearly-summary/:year', auth, (req, res) => {
  const year = req.params.year; // YYYY

  db.query(
    `
    SELECT
      SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense
    FROM expenses
    WHERE user_id = ?
      AND YEAR(created_at) = ?
    `,
    [req.userId, year],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const income = result[0].income || 0;
      const expense = result[0].expense || 0;

      res.json({
        income,
        expense,
        balance: income - expense
      });
    }
  );
});

app.get('/chart-data/yearly/:year', auth, (req, res) => {
  const year = req.params.year;

  db.query(
    `
    SELECT category, SUM(amount) AS total
    FROM expenses
    WHERE user_id = ?
      AND type = 'expense'
      AND YEAR(created_at) = ?
    GROUP BY category
    `,
    [req.userId, year],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json(result);
    }
  );
});

/* =========================
   SERVER START
========================= */
app.listen(5000, () => {
  console.log("✅ Backend running on http://localhost:5000");
});

