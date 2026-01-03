require('dotenv').config();

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// === Brevo email config (from environment variables) ===
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = 'internetbilling.bh@gmail.com';
const SENDER_NAME = 'AirFiber Internet Billing';

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// === SQLite database setup ===
const db = new sqlite3.Database('./billing.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      amount TEXT NOT NULL,
      dueDate TEXT NOT NULL,
      wifi TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    (err) => {
      if (err) {
        console.error('Error creating clients table:', err.message);
      } else {
        console.log('Clients table ready.');
      }
    }
  );
});

// === Helper to send email via Brevo ===
async function sendEmailViaBrevo({ toEmail, toName, subject, htmlContent, textContent }) {
  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not set.');
  }

  const payload = {
    sender: { email: SENDER_EMAIL, name: SENDER_NAME },
    to: [{ email: toEmail, name: toName || '' }],
    subject,
    htmlContent,
    textContent: textContent || ''
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('Brevo error body:', body);
    throw new Error(`Brevo API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// === Email templates (HTML) ===
function buildEmailHtml(type, client, messageText) {
  const name = client?.name || 'Customer';
  const amount = client?.amount || '';
  const wifi = client?.wifi || '';
  const dueDate = client?.dueDate || '';

  const baseStyles = `
    body { font-family: Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 16px; }
    .card { background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
    .header { padding: 16px 20px; color: #ffffff; font-weight: bold; font-size: 18px; }
    .content { padding: 16px 20px 20px 20px; color: #111827; font-size: 14px; }
    .footer { padding: 12px 20px 16px 20px; font-size: 12px; color: #6b7280; background-color: #f9fafb; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
    .pill-reminder { background-color: #f97316; color: #fff7ed; }
    .pill-receipt { background-color: #22c55e; color: #ecfdf5; }
    .pill-disconnect { background-color: #b91c1c; color: #fee2e2; }
    .amount { font-size: 22px; font-weight: 700; margin: 6px 0; }
    .details-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .details-table th, .details-table td { font-size: 12px; text-align: left; padding: 4px 0; }
    .details-table th { color: #6b7280; font-weight: 500; width: 120px; }
  `;

  let headerColor = '#111827';
  let headerText = 'AirFiber Internet Billing';
  let pillClass = 'pill-reminder';
  let pillText = 'BILLING REMINDER';
  let intro = `Hi ${name},`;
  let bodyMain = messageText || '';

  if (type === 'receipt') {
    headerColor = '#14532d';
    pillClass = 'pill-receipt';
    pillText = 'PAYMENT RECEIPT';
    intro = `Hi ${name},`;
    bodyMain = `
      This is your official receipt for the payment received.
      <br/><br/>
      We have successfully received your payment for your AirFiber Internet subscription.
    `;
  } else if (type === 'disconnection') {
    headerColor = '#7f1d1d';
    pillClass = 'pill-disconnect';
    pillText = 'DISCONNECTION NOTICE';
    intro = `Hi ${name},`;
    bodyMain = `
      Our records show that your account is now <strong>overdue</strong>.
      Your service is scheduled for <strong>disconnection</strong> if payment is not received as soon as possible.
    `;
  } else {
    // reminder
    headerColor = '#1f2937';
    pillClass = 'pill-reminder';
    pillText = 'BILLING REMINDER';
    intro = `Hi ${name},`;
    bodyMain = `
      This is a friendly reminder for your upcoming AirFiber Internet bill.
      <br/><br/>
      If you have already paid, please ignore this message.
    `;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${pillText}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header" style="background-color: ${headerColor};">
        AirFiber Internet Billing
      </div>
      <div class="content">
        <span class="pill ${pillClass}">${pillText}</span>
        <p style="margin-top: 12px; margin-bottom: 8px;">${intro}</p>

        <p style="margin-top: 0; margin-bottom: 10px;">
          ${bodyMain}
        </p>

        <div style="margin-top: 10px; padding: 10px 12px; background-color:#f9fafb; border-radius: 8px; border:1px solid #e5e7eb;">
          <div class="amount">₱${amount}</div>
          <table class="details-table">
            <tr>
              <th>Customer</th>
              <td>${name}</td>
            </tr>
            <tr>
              <th>WiFi</th>
              <td>${wifi}</td>
            </tr>
            <tr>
              <th>Due Date</th>
              <td>${dueDate}</td>
            </tr>
          </table>
        </div>

        <p style="margin-top: 14px;">
          Thank you for choosing <strong>AirFiber Internet</strong>.
        </p>
      </div>
      <div class="footer">
        This email was sent automatically by the AirFiber Internet Billing system.
      </div>
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

// === Routes for pages ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// === API: get all clients ===
app.get('/api/clients', (req, res) => {
  db.all('SELECT * FROM clients ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('Error fetching clients:', err.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }
    res.json({ clients: rows });
  });
});

// === API: add client ===
app.post('/api/clients', (req, res) => {
  const { name, email, phone, amount, dueDate, wifi } = req.body;

  if (!name || !email || !amount || !dueDate || !wifi) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const stmt = db.prepare(
    'INSERT INTO clients (name, email, phone, amount, dueDate, wifi, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(name, email, phone || '', amount, dueDate, wifi, 'pending', function (err) {
    if (err) {
      console.error('Error inserting client:', err.message);
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
      status: 'pending'
    };
    res.json({ client: newClient });
  });
});

// === API: update client status (paid/pending/disconnected) ===
app.post('/api/clients/:id/status', (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  db.run(
    'UPDATE clients SET status = ? WHERE id = ?',
    [status, id],
    function (err) {
      if (err) {
        console.error('Error updating status:', err.message);
        return res.status(500).json({ error: 'Failed to update status' });
      }
      res.json({ success: true, updated: this.changes });
    }
  );
});

// === API: update all due dates ===
app.post('/api/clients/update-due-dates', (req, res) => {
  const { dueDate } = req.body;
  if (!dueDate) {
    return res.status(400).json({ error: 'Missing dueDate' });
  }

  db.run(
    'UPDATE clients SET dueDate = ?',
    [dueDate],
    function (err) {
      if (err) {
        console.error('Error updating due dates:', err.message);
        return res.status(500).json({ error: 'Failed to update due dates' });
      }
      res.json({ success: true, updatedCount: this.changes });
    }
  );
});

// === API: delete client ===
app.delete('/api/clients/:id', (req, res) => {
  const id = req.params.id;

  db.run('DELETE FROM clients WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('Error deleting client:', err.message);
      return res.status(500).json({ error: 'Failed to delete client' });
    }
    res.json({ success: true, deleted: this.changes });
  });
});

// === API: edit client ===
app.put('/api/clients/:id', (req, res) => {
  const id = req.params.id;
  const { name, email, phone, amount, dueDate, wifi } = req.body;

  if (!name || !email || !amount || !dueDate || !wifi) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.run(
    'UPDATE clients SET name = ?, email = ?, phone = ?, amount = ?, dueDate = ?, wifi = ? WHERE id = ?',
    [name, email, phone || '', amount, dueDate, wifi, id],
    function (err) {
      if (err) {
        console.error('Error updating client:', err.message);
        return res.status(500).json({ error: 'Failed to update client' });
      }
      res.json({ success: true, updated: this.changes });
    }
  );
});

// === API: send email (uses Brevo) ===
app.post('/api/send-email', async (req, res) => {
  try {
    const { email, subject, message, type, client } = req.body;
    if (!email || !subject) {
      return res.status(400).json({ error: 'Missing email or subject' });
    }

    const html = buildEmailHtml(type || 'reminder', client || {}, message || '');
    await sendEmailViaBrevo({
      toEmail: email,
      toName: client?.name || 'Customer',
      subject,
      htmlContent: html,
      textContent: message || ''
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`AirFiber Internet Billing backend running on port ${PORT}`);
});
