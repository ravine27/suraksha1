import os
import shutil
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3

from alpha_scanner import AlphaScanner
from beta_orchestrator import BetaOrchestrator
from database import get_db_connection, init_db

# Initialize FastAPI App
app = FastAPI(title="Sentinel-RegAI Compliance Backend", version="1.0.0")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to the frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Upload folders
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Ensure database is initialized
init_db()

# Initialize Agents
scanner = AlphaScanner()
orchestrator = BetaOrchestrator()

# Pydantic Schemas
class SettingsUpdate(BaseModel):
    threshold: float
    gemini_api_key: str
    skills_IT: str
    skills_HR: str
    skills_Legal: str
    skills_Treasury: str

class ManualTextIngest(BaseModel):
    document_name: str
    text_content: str

@app.get("/api/dashboard")
def get_dashboard_stats():
    """Returns overview statistics for the compliance dashboard."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Total documents scanned (distinct document names)
        cursor.execute("SELECT COUNT(DISTINCT document_name) FROM alerts")
        total_docs = cursor.fetchone()[0]
        
        # Total alerts (segments)
        cursor.execute("SELECT COUNT(*) FROM alerts")
        total_alerts = cursor.fetchone()[0]
        
        # Total escalated alerts (anomalies)
        cursor.execute("SELECT COUNT(*) FROM alerts WHERE is_escalated = 1")
        total_escalated = cursor.fetchone()[0]
        
        # Tickets by status
        cursor.execute("SELECT status, COUNT(*) FROM tickets GROUP BY status")
        status_rows = cursor.fetchall()
        status_counts = {row[0]: row[1] for row in status_rows}
        
        # Tickets by department
        cursor.execute("SELECT department, COUNT(*) FROM tickets GROUP BY department")
        dept_rows = cursor.fetchall()
        dept_counts = {row[0]: row[1] for row in dept_rows}
        
        # Completed/Approved vs Total tickets
        cursor.execute("SELECT COUNT(*) FROM tickets")
        total_tickets = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM tickets WHERE status = 'Approved'")
        approved_tickets = cursor.fetchone()[0]
        
        compliance_rate = (approved_tickets / total_tickets * 100) if total_tickets > 0 else 100.0
        
        conn.close()
        
        return {
            "total_documents": total_docs,
            "total_alerts": total_alerts,
            "total_escalated": total_escalated,
            "compliance_rate": round(compliance_rate, 2),
            "tickets_status": {
                "Open": status_counts.get("Open", 0),
                "Submitted": status_counts.get("Submitted", 0),
                "Approved": status_counts.get("Approved", 0),
                "Rejected": status_counts.get("Rejected", 0),
            },
            "tickets_department": {
                "IT": dept_counts.get("IT", 0),
                "HR": dept_counts.get("HR", 0),
                "Legal": dept_counts.get("Legal", 0),
                "Treasury": dept_counts.get("Treasury", 0),
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/alerts")
def get_alerts():
    """Retrieves all scanned alert segments."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM alerts ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tickets")
def get_tickets(department: str = None):
    """Retrieves all generated tickets, optionally filtered by department."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if department:
            cursor.execute("SELECT * FROM tickets WHERE department = ? ORDER BY id DESC", (department,))
        else:
            cursor.execute("SELECT * FROM tickets ORDER BY id DESC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/settings")
def get_settings():
    """Retrieves compliance system settings."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM settings")
        rows = cursor.fetchall()
        conn.close()
        return {row['key']: row['value'] for row in rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/settings")
def update_settings(data: SettingsUpdate):
    """Updates compliance system settings and threshold."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('threshold', ?)", (str(data.threshold),))
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_api_key', ?)", (data.gemini_api_key,))
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('skills_IT', ?)", (data.skills_IT,))
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('skills_HR', ?)", (data.skills_HR,))
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('skills_Legal', ?)", (data.skills_Legal,))
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('skills_Treasury', ?)", (data.skills_Treasury,))
        
        conn.commit()
        conn.close()
        
        # Update scanner model path if needed or just output OK
        return {"status": "success", "message": "Settings updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def process_scanned_segments(document_name, segments, threshold):
    """Saves segments, runs Agent Beta to generate MAPs, routes tasks, and creates tickets."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    escalated_count = 0
    for seg in segments:
        content = seg["content"]
        rscore = seg["rscore"]
        is_escalated = 1 if rscore >= threshold else 0
        
        # Insert alert
        cursor.execute("""
        INSERT INTO alerts (document_name, content, rscore, is_escalated, status)
        VALUES (?, ?, ?, ?, ?)
        """, (document_name, content, rscore, is_escalated, "escalated" if is_escalated else "dismissed"))
        alert_id = cursor.lastrowid
        
        if is_escalated:
            escalated_count += 1
            # Run Agent Beta MAP generation
            title, map_desc = orchestrator.generate_map(content)
            
            # Route to department
            dept, similarity = orchestrator.route_task(map_desc)
            
            # Create Ticket
            cursor.execute("""
            INSERT INTO tickets (alert_id, title, description, department, similarity_score, status)
            VALUES (?, ?, ?, ?, ?, 'Open')
            """, (alert_id, title, map_desc, dept, similarity))
            
    conn.commit()
    conn.close()
    return escalated_count

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...), threshold: float = Form(0.50)):
    """Handles PDF file uploads, extracts text, runs Alpha scanning, and generates tickets."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Run Scanning Pipeline
        results = scanner.scan_document(file_path, threshold=threshold)
        
        # Save and Generate Tickets
        escalated_count = process_scanned_segments(file.filename, results, threshold)
        
        return {
            "status": "success",
            "document_name": file.filename,
            "total_segments": len(results),
            "escalated_count": escalated_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ingest-text")
def ingest_text(data: ManualTextIngest):
    """Ingests raw text guidelines manually for testing compliance triggers."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = 'threshold'")
        threshold = float(cursor.fetchone()[0])
        conn.close()
        
        # Tokenize and score manual input segment
        rscore = scanner.score_segment(data.text_content)
        
        # Structure as list segment
        segments = [{
            "content": data.text_content,
            "rscore": rscore
        }]
        
        escalated_count = process_scanned_segments(data.document_name, segments, threshold)
        
        return {
            "status": "success",
            "rscore": rscore,
            "is_escalated": rscore >= threshold,
            "escalated_count": escalated_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tickets/{ticket_id}/submit-evidence")
async def submit_evidence(
    ticket_id: int, 
    evidence_text: str = Form(None), 
    file: UploadFile = File(None)
):
    """Submits evidence (text/file) for a ticket, audits it, and updates ticket status."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT description FROM tickets WHERE id = ?", (ticket_id,))
        ticket = cursor.fetchone()
        
        if not ticket:
            conn.close()
            raise HTTPException(status_code=404, detail="Ticket not found")
            
        map_description = ticket['description']
        extracted_text = ""
        filename = "Manual Text Entry"
        
        if file:
            filename = file.filename
            file_path = os.path.join(UPLOAD_DIR, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
                
            # Extract text from evidence file
            if file.filename.lower().endswith(".pdf"):
                pages = scanner.extract_text_from_pdf(file_path)
                extracted_text = " ".join(pages)
            else:
                # Assume text file
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    extracted_text = f.read()
        elif evidence_text:
            extracted_text = evidence_text
        else:
            conn.close()
            raise HTTPException(status_code=400, detail="Either evidence_text or file must be provided")
            
        # Run Auditing Engine
        passed, score, feedback = orchestrator.audit_evidence(map_description, extracted_text)
        
        status = "Approved" if passed else "Rejected"
        
        # Update Ticket
        cursor.execute("""
        UPDATE tickets
        SET status = ?, evidence_text = ?, evidence_file = ?, audit_score = ?, audit_feedback = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (status, extracted_text, filename, score, feedback, ticket_id))
        
        conn.commit()
        conn.close()
        
        return {
            "status": "success",
            "audit_passed": passed,
            "audit_score": score,
            "feedback": feedback,
            "ticket_status": status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/audit-loop")
def run_continuous_audit_loop():
    """Triggers an audit recheck on all tickets currently in 'Submitted' or 'Rejected' state.
    Simulates a background cron task auditing evidence.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, description, evidence_text, evidence_file FROM tickets WHERE evidence_text IS NOT NULL AND status IN ('Submitted', 'Rejected', 'Open')")
        rows = cursor.fetchall()
        
        audited_count = 0
        for row in rows:
            ticket_id = row['id']
            map_desc = row['description']
            evidence_text = row['evidence_text']
            evidence_file = row['evidence_file']
            
            # Recheck evidence
            passed, score, feedback = orchestrator.audit_evidence(map_desc, evidence_text)
            status = "Approved" if passed else "Rejected"
            
            cursor.execute("""
            UPDATE tickets
            SET status = ?, audit_score = ?, audit_feedback = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """, (status, score, feedback, ticket_id))
            audited_count += 1
            
        conn.commit()
        conn.close()
        return {"status": "success", "audited_tickets_count": audited_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
