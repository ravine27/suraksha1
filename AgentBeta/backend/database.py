import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sentinel_regai.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create alerts table (scanned paragraphs from documents/feeds)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_name TEXT NOT NULL,
        content TEXT NOT NULL,
        rscore REAL NOT NULL,
        is_escalated INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Create tickets table (Measurable Action Points - MAPs assigned to departments)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id INTEGER,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        department TEXT NOT NULL,
        similarity_score REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'Open',
        evidence_text TEXT,
        evidence_file TEXT,
        audit_score REAL,
        audit_feedback TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (alert_id) REFERENCES alerts (id) ON DELETE SET NULL
    )
    """)

    # Create settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)

    # Insert default settings if not exists
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('threshold', '0.50')")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('gemini_api_key', '')")

    # Insert default department skill profiles
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('skills_IT', 'cybersecurity data encryption AES-256 cloud systems firewall access control authentication API security network vulnerability patch management protocol HTTPS SSL TLS')")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('skills_HR', 'employee training hiring onboarding policy dissemination staff compliance benefits payroll labor laws workplace safety code of conduct')")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('skills_Legal', 'compliance audits contracts review regulatory filings litigation GDPR data privacy laws SEC disclosures disclosure advisory policy drafting')")
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('skills_Treasury', 'capital adequacy liquidity risk asset liability management forex currency reserve banking audit balance sheet cost control funding capital requirements')")

    conn.commit()
    conn.close()
    print("Database initialized successfully at:", DB_PATH)

if __name__ == "__main__":
    init_db()
