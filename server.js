const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Database connection
const db = mysql.createConnection({
  host: "localhost",
  user: "root",       // your MySQL username
  password: "618913", // your MySQL password
  database: "river_view_db"
});

db.connect(err => {
  if (err) throw err;
  console.log("✅ MySQL Connected!");
});

const SECRET = "river_secret";

// ✅ Middleware: verify token
function verifyToken(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(403).json({ message: "Token required" });

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid token" });
    req.userId = decoded.userId;
    next();
  });
}

// ✅ Signup
app.post("/signup", (req, res) => {
  const { name, email, password } = req.body;
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) throw err;
    db.query(
      "INSERT INTO users (name, email, password, wallet) VALUES (?, ?, ?, 0)",
      [name, email, hash],
      (err) => {
        if (err) return res.status(400).json({ message: "Email already used!" });
        res.json({ message: "User registered!" });
      }
    );
  });
});

// ✅ Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.query("SELECT * FROM users WHERE email=?", [email], (err, result) => {
    if (err) throw err;
    if (result.length === 0)
      return res.status(400).json({ message: "User not found" });

    bcrypt.compare(password, result[0].password, (err, match) => {
      if (!match) return res.status(401).json({ message: "Wrong password" });

      const token = jwt.sign(
        { userId: result[0].user_id },
        SECRET,
        { expiresIn: "2h" }
      );

      res.json({
        token,
        user: {
          user_id: result[0].user_id,
          name: result[0].name,
          wallet: Number(result[0].wallet)
        }
      });
    });
  });
});

// ✅ Current user info
app.get("/me", verifyToken, (req, res) => {
  db.query(
    "SELECT user_id, name, email, wallet FROM users WHERE user_id=?",
    [req.userId],
    (err, result) => {
      if (err) throw err;
      if (result.length === 0)
        return res.status(404).json({ message: "User not found" });

      res.json({
        id: result[0].user_id,
        name: result[0].name,
        email: result[0].email,
        wallet: Number(result[0].wallet)
      });
    }
  );
});

// ✅ Get foods
app.get("/foods", (req, res) => {
  db.query("SELECT * FROM food_items", (err, result) => {
    if (err) throw err;
    res.json(result);
  });
});

// ✅ Add to cart
app.post("/cart", verifyToken, (req, res) => {
  const { food_id } = req.body;
  db.query(
    "INSERT INTO cart (user_id, food_id, quantity) VALUES (?, ?, 1)",
    [req.userId, food_id],
    (err) => {
      if (err) throw err;
      res.json({ message: "Added to cart!" });
    }
  );
});

// ✅ Place order (fixed wallet issue)
app.post("/cart/order", verifyToken, (req, res) => {
  const cartItems = req.body.cart; // [{food_id, name, price, quantity}]

  if (!cartItems || cartItems.length === 0)
    return res.status(400).json({ message: "Cart is empty" });

  const total = cartItems.reduce((sum, item) => {
    const price = parseFloat(item.price) || 0;
    const qty = parseInt(item.quantity) || 0;
    return sum + price * qty;
  }, 0);

  const finalTotal = parseFloat(total.toFixed(2));

  db.query("SELECT wallet FROM users WHERE user_id=?", [req.userId], (err, result) => {
    if (err) throw err;
    const walletBalance = Number(result[0].wallet);

    if (walletBalance < finalTotal)
      return res.status(400).json({ message: "Insufficient wallet balance" });

    // Deduct wallet
    db.query(
      "UPDATE users SET wallet = wallet - ? WHERE user_id=?",
      [finalTotal, req.userId],
      (err) => {
        if (err) return res.status(500).json({ message: "Failed to deduct wallet" });

        // Save transaction
        db.query(
          "INSERT INTO transactions (user_id, amount, type) VALUES (?, ?, 'purchase')",
          [req.userId, finalTotal],
          (err) => {
            if (err) return res.status(500).json({ message: "Failed to record transaction" });

            // Clear cart
            db.query("DELETE FROM cart WHERE user_id=?", [req.userId], (err) => {
              if (err) return res.status(500).json({ message: "Failed to clear cart" });
              res.json({ message: "Order placed successfully!" });
            });
          }
        );
      }
    );
  });
});

// ✅ Get cart
app.get("/cart", verifyToken, (req, res) => {
  db.query(
    "SELECT c.cart_id, f.name, f.price, c.quantity FROM cart c JOIN food_items f ON c.food_id=f.food_id WHERE c.user_id=?",
    [req.userId],
    (err, result) => {
      if (err) throw err;
      res.json(result);
    }
  );
});

// ✅ Add money to wallet
app.post("/wallet/add", verifyToken, (req, res) => {
  const { amount, password } = req.body;
  db.query("SELECT * FROM users WHERE user_id=?", [req.userId], (err, user) => {
    if (err) throw err;
    if (!user.length) return res.status(404).json({ message: "User not found" });

    bcrypt.compare(password, user[0].password, (err, match) => {
      if (!match) return res.status(401).json({ message: "Wrong password" });

      const addAmount = Number(amount) || 0;

      db.query(
        "UPDATE users SET wallet = wallet + ? WHERE user_id=?",
        [addAmount, req.userId],
        (err) => {
          if (err) throw err;
          db.query(
            "INSERT INTO transactions (user_id, amount, type) VALUES (?, ?, 'add')",
            [req.userId, addAmount],
            (err) => {
              if (err) throw err;
              res.json({ message: "Money added successfully!" });
            }
          );
        }
      );
    });
  });
});

// ✅ Get transactions
app.get("/transactions", verifyToken, (req, res) => {
  db.query(
    "SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC",
    [req.userId],
    (err, result) => {
      if (err) throw err;
      res.json(result);
    }
  );
});

// ✅ Reviews
app.get("/reviews", (req, res) => {
  db.query(
    "SELECT r.message, r.date, u.name FROM reviews r JOIN users u ON r.user_id=u.user_id ORDER BY r.date DESC",
    (err, result) => {
      if (err) throw err;
      res.json(result);
    }
  );
});

app.post("/reviews", verifyToken, (req, res) => {
  const { message } = req.body;
  db.query(
    "INSERT INTO reviews (user_id, message) VALUES (?, ?)",
    [req.userId, message],
    (err) => {
      if (err) throw err;
      res.json({ message: "Review added!" });
    }
  );
});

// ✅ Start server
app.listen(5000, () => console.log("🚀 Server running on http://localhost:5000"));
