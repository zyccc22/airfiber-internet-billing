require('dotenv').config();
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

// 👇 Read Gmail + App Password from environment (from .env)
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('ERROR: GMAIL_USER or GMAIL_APP_PASSWORD is missing in environment variables.');
}

// Nodemailer transporter using Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

// ---- Database setup (SQLite) ----
const db = new sqlite3.Database(path.join(__dirname, 'billing.db'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      amount TEXT,
      dueDate TEXT,
      wifi TEXT,
      status TEXT DEFAULT 'pending' -- pending | paid | disconnected
    )
  `);
});

// ---- Middlewares ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Pages ----
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ---- API: get all clients ----
app.get('/api/clients', (req, res) => {
  db.all('SELECT * FROM clients ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('Error fetching clients:', err);
      return res.status(500).json({ error: 'Failed to load clients' });
    }
    res.json({ clients: rows });
  });
});

// ---- API: add a new client ----
app.post('/api/clients', (req, res) => {
  const { name, email, phone, amount, dueDate, wifi } = req.body;

  if (!name || !email || !amount || !dueDate || !wifi) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sql = `
    INSERT INTO clients (name, email, phone, amount, dueDate, wifi, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `;
  const params = [name, email, phone || '', amount, dueDate, wifi];

  db.run(sql, params, function (err) {
    if (err) {
      console.error('Error inserting client:', err);
      return res.status(500).json({ error: 'Failed to save client' });
    }

    const newClient = {
      id: this.lastID,
      name,
      email,
      phone: phone || '',
      amount,
      dueDate,
      wifi,
      status: 'pending',
    };

    console.log('Client added:', newClient);
    res.json({ success: true, client: newClient });
  });
});

// ---- API: update client status (pending / paid / disconnected) ----
app.post('/api/clients/:id/status', (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  const allowedStatuses = ['pending', 'paid', 'disconnected'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const sql = 'UPDATE clients SET status = ? WHERE id = ?';
  db.run(sql, [status, id], function (err) {
    if (err) {
      console.error('Error updating status:', err);
      return res.status(500).json({ error: 'Failed to update status' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ success: true });
  });
});

// ---- API: delete client ----
app.delete('/api/clients/:id', (req, res) => {
  const id = req.params.id;

  const sql = 'DELETE FROM clients WHERE id = ?';
  db.run(sql, [id], function (err) {
    if (err) {
      console.error('Error deleting client:', err);
      return res.status(500).json({ error: 'Failed to delete client' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ success: true });
  });
});

// ---- API: update due date for ALL clients (global billing date) ----
app.post('/api/clients/update-due-dates', (req, res) => {
  const { dueDate } = req.body;

  if (!dueDate) {
    return res.status(400).json({ error: 'dueDate is required' });
  }

  const sql = 'UPDATE clients SET dueDate = ?';
  db.run(sql, [dueDate], function (err) {
    if (err) {
      console.error('Error updating due dates:', err);
      return res.status(500).json({ error: 'Failed to update due dates' });
    }

    res.json({ success: true, updatedCount: this.changes });
  });
});

// ---- HTML email template (Netflix-ish style) ----
function buildHtmlEmail(client = {}, subject, message, type = 'reminder') {
  const name = client.name || 'Valued Customer';
  const amount = client.amount || '';
  const dueDate = client.dueDate || '';
  const wifi = client.wifi || '';
  const mac = client.phone || ''; // we store Device MAC in "phone" field

  let bannerText = '';
  let bannerColor = '#0073e6'; // blue
  let titleText = subject || 'Billing Reminder';

  if (type === 'receipt') {
    bannerText = 'Payment received';
    bannerColor = '#2bb24c';
    titleText = 'Thank you for your payment';
  } else if (type === 'disconnection') {
    bannerText = 'Important account notice';
    bannerColor = '#e50914'; // Netflix red style
    titleText = 'Your account is scheduled for disconnection';
  } else {
    bannerText = 'Your payment is due soon';
    bannerColor = '#f79e1b';
    titleText = 'Please review your billing details';
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${titleText}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td align="center" style="padding:0;margin:0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background-color:#ffffff;">
          <!-- Brand bar -->
          <tr>
            <td style="padding:16px 24px;background-color:#e50914;color:#ffffff;font-size:24px;font-weight:bold;">
              AirFiber Internet Billing
            </td>
          </tr>

          <!-- Status bar -->
          <tr>
            <td style="background-color:${bannerColor};color:#ffffff;padding:10px 24px;font-size:14px;font-weight:bold;">
              ${bannerText}
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding:24px;">
              <h1 style="margin:0 0 12px 0;font-size:24px;color:#000000;">${titleText}</h1>
              <p style="margin:0 0 12px 0;font-size:14px;color:#333333;">Hi ${name},</p>
              <p style="margin:0 0 16px 0;font-size:14px;color:#333333;line-height:1.4;">
                ${message.replace(/\n/g, '<br />')}
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #dddddd;border-radius:8px;margin:16px 0;">
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#555555;">
                    <strong>WiFi:</strong> ${wifi || '-'}<br />
                    <strong>Amount:</strong> ₱${amount || '-'}<br />
                    <strong>Due date:</strong> ${dueDate || '-'}<br />
                    <strong>Device MAC:</strong> ${mac || '-'}
                  </td>
                </tr>
              </table>

              <p style="margin:16px 0 0 0;font-size:12px;color:#777777;line-height:1.4%;">
                This email was sent by your AirFiber Internet Billing system. If you believe you received this in error,
                please contact your administrator.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;font-size:11px;color:#999999;background-color:#f5f5f5;">
              © ${new Date().getFullYear()} AirFiber Internet Billing. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

// ---- Helper: send email (text + HTML) ----
async function sendEmail(to, subject, text, html) {
  const info = await transporter.sendMail({
    from: `"AirFiber Internet Billing" <${GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });

  console.log('Email sent:', info.messageId);
}

// ---- API: manual send email (reminder / receipt / disconnection) ----
app.post('/api/send-email', async (req, res) => {
  const { email, subject, message, type, client } = req.body;

  if (!email || !message) {
    return res.status(400).json({ error: 'email and message are required' });
  }

  const textMessage = message;
  const htmlMessage = buildHtmlEmail(client || {}, subject, message, type || 'reminder');

  try {
    await sendEmail(email, subject || 'Billing Reminder', textMessage, htmlMessage);
    return res.json({ success: true });
  } catch (err) {
    console.error('Error sending email:', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
