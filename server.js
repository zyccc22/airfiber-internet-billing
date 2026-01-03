require('dotenv').config();
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

// 👇 Read Gmail + App Password from .env
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('ERROR: GMAIL_USER or GMAIL_APP_PASSWORD is missing in .env');
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

// ---- API: update client FULL data (Edit button) ----
app.put('/api/clients/:id', (req, res) => {
  const id = req.params.id;
  const { name, email, phone, amount, dueDate, wifi } = req.body;

  if (!name || !email || !amount || !dueDate || !wifi) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sql = `
    UPDATE clients
    SET name = ?, email = ?, phone = ?, amount = ?, dueDate = ?, wifi = ?
    WHERE id = ?
  `;
  const params = [name, email, phone || '', amount, dueDate, wifi, id];

  db.run(sql, params, function (err) {
    if (err) {
      console.error('Error updating client:', err);
      return res.status(500).json({ error: 'Failed to update client' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ success: true });
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

// ---- HTML email templates ----
function buildHtmlEmail(client = {}, subject, message, type = 'reminder') {
  const name = client.name || 'Valued Customer';
  const amount = client.amount || '';
  const dueDate = client.dueDate || '';
  const wifi = client.wifi || '';
  const mac = client.phone || ''; // Device MAC stored in "phone"

  // RECEIPT – narrow, text-style like a printed slip
  if (type === 'receipt') {
    const paymentDate = new Date();
    const dateStr = paymentDate.toLocaleDateString('en-PH');
    const timeStr = paymentDate.toLocaleTimeString('en-PH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payment Receipt</title>
</head>
<body style="margin:0;padding:0;background-color:#e5e7eb;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td align="center" style="padding:24px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="360" style="background-color:#ffffff;border:1px solid #d1d5db;">
          <tr>
            <td style="padding:12px 8px;text-align:center;font-family:'Courier New',monospace;">
              <div style="font-size:18px;font-weight:bold;">AIRFIBER INTERNET</div>
              <div style="font-size:12px;">Official Receipt</div>
              <div style="font-size:11px;margin-top:4px;">Thank you for your payment</div>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px;font-family:'Courier New',monospace;font-size:11px;">
              DATE: ${dateStr}   TIME: ${timeStr}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px;font-family:'Courier New',monospace;font-size:11px;">
              CUSTOMER: ${name}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px;font-family:'Courier New',monospace;font-size:11px;">
              SERVICE : ${wifi || 'INTERNET SERVICE'}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px;font-family:'Courier New',monospace;font-size:11px;">
              DUE DATE: ${dueDate || '-'}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 8px 8px;font-family:'Courier New',monospace;font-size:11px;">
              DEVICE MAC: ${mac || '-'}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 0 8px;font-family:'Courier New',monospace;font-size:11px;">
              ----------------------------------------
            </td>
          </tr>
          <tr>
            <td style="padding:0 8px;font-family:'Courier New',monospace;font-size:11px;">
              DESCRIPTION                 AMOUNT
            </td>
          </tr>
          <tr>
            <td style="padding:0 8px;font-family:'Courier New',monospace;font-size:11px;">
              ----------------------------------------
            </td>
          </tr>
          <tr>
            <td style="padding:0 8px 4px 8px;font-family:'Courier New',monospace;font-size:11px;">
              INTERNET SERVICE           ₱${amount || '-'}
            </td>
          </tr>
          <tr>
            <td style="padding:0 8px;font-family:'Courier New',monospace;font-size:11px;">
              ----------------------------------------
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 8px 8px;font-family:'Courier New',monospace;font-size:11px;">
              TOTAL                      ₱${amount || '-'}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 12px 8px;font-family:'Courier New',monospace;font-size:11px;">
              PAYMENT METHOD: CASH/GCASH
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 12px 8px;font-family:'Courier New',monospace;font-size:11px;text-align:center;">
              *** NO SIGNATURE REQUIRED ***
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 12px 8px;font-family:'Courier New',monospace;font-size:10px;text-align:center;color:#6b7280;">
              This email serves as your official receipt from AirFiber Internet Billing.
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

  // Modern layout for REMINDER + DISCONNECTION
  let bannerText = '';
  let bannerColor = '#0073e6'; // default accent
  let titleText = subject || 'Billing Reminder';

  if (type === 'disconnection') {
    bannerText = 'Important account notice';
    bannerColor = '#b91c1c'; // deep red
    titleText = 'Your account is scheduled for disconnection';
  } else {
    bannerText = 'Your payment is due soon';
    bannerColor = '#f97316'; // orange accent
    titleText = 'Please review your billing details';
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${titleText}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td align="center" style="padding:24px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="background:linear-gradient(135deg,#020617,#111827);border-radius:12px;overflow:hidden;border:1px solid #1f2937;">
          <!-- Brand bar -->
          <tr>
            <td style="padding:16px 24px;background:linear-gradient(90deg,#e50914,#b91c1c);color:#ffffff;font-size:22px;font-weight:bold;">
              AirFiber Internet Billing
            </td>
          </tr>

          <!-- Status bar -->
          <tr>
            <td style="background-color:${bannerColor};color:#ffffff;padding:10px 24px;font-size:13px;font-weight:bold;">
              ${bannerText}
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding:24px;background-color:#020617;color:#e5e7eb;">
              <h1 style="margin:0 0 12px 0;font-size:22px;color:#ffffff;">${titleText}</h1>
              <p style="margin:0 0 8px 0;font-size:14px;">Hi ${name},</p>
              <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#d1d5db;">
                ${message.replace(/\n/g, '<br />')}
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border-radius:10px;background-color:#020617;border:1px solid #1f2937;margin:16px 0;">
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#9ca3af;border-bottom:1px solid #1f2937;">
                    <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">WiFi</span>
                    <span style="font-size:13px;color:#e5e7eb;">${wifi || '-'}</span>
                  </td>
                  <td style="padding:12px 16px;font-size:13px;color:#9ca3af;border-bottom:1px solid #1f2937;">
                    <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Amount</span>
                    <span style="font-size:13px;color:#e5e7eb;">₱${amount || '-'}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;font-size:13px;color:#9ca3af;">
                    <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Due date</span>
                    <span style="font-size:13px;color:#e5e7eb;">${dueDate || '-'}</span>
                  </td>
                  <td style="padding:12px 16px;font-size:13px;color:#9ca3af;">
                    <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Device MAC</span>
                    <span style="font-size:13px;color:#e5e7eb;">${mac || '-'}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:16px 0 0 0;font-size:11px;color:#6b7280;line-height:1.5;">
                This email was sent by your AirFiber Internet Billing system. If you believe you received this in error,
                please contact your administrator.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:12px 24px;font-size:11px;color:#6b7280;background-color:#020617;text-align:center;border-top:1px solid #1f2937;">
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
