import requests
import os

API_BASE = "http://127.0.0.1:8000/api"
PDF_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "BankSavers.pdf")

def run_tests():
    print("=== STARTING INTEGRATION TESTS FOR SENTINEL-REGAI ===")
    
    # 1. Test Settings GET
    print("\n[1] Testing GET /api/settings...")
    res = requests.get(f"{API_BASE}/settings")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    settings = res.json()
    print("Settings received:", settings)
    assert "threshold" in settings
    
    # 2. Test Ingestion via PDF Upload
    print(f"\n[2] Testing POST /api/upload with PDF: {PDF_PATH}...")
    assert os.path.exists(PDF_PATH), f"PDF file not found at {PDF_PATH}"
    
    with open(PDF_PATH, "rb") as f:
        files = {"file": (os.path.basename(PDF_PATH), f, "application/pdf")}
        data = {"threshold": 0.50}
        res = requests.post(f"{API_BASE}/upload", files=files, data=data)
        
    assert res.status_code == 200, f"Upload failed with {res.status_code}: {res.text}"
    upload_res = res.json()
    print("Upload result:", upload_res)
    assert upload_res["status"] == "success"
    assert upload_res["escalated_count"] > 0
    
    # 3. Test Dashboard Stats
    print("\n[3] Testing GET /api/dashboard...")
    res = requests.get(f"{API_BASE}/dashboard")
    assert res.status_code == 200
    stats = res.json()
    print("Dashboard Stats:", stats)
    assert stats["total_documents"] >= 1
    assert stats["total_escalated"] > 0
    
    # 4. Test Alerts GET
    print("\n[4] Testing GET /api/alerts...")
    res = requests.get(f"{API_BASE}/alerts")
    assert res.status_code == 200
    alerts = res.json()
    print(f"Total alerts in DB: {len(alerts)}")
    assert len(alerts) > 0
    
    # 5. Test Tickets GET
    print("\n[5] Testing GET /api/tickets...")
    res = requests.get(f"{API_BASE}/tickets")
    assert res.status_code == 200
    tickets = res.json()
    print(f"Total tickets in DB: {len(tickets)}")
    assert len(tickets) > 0
    
    # 6. Test Submit Evidence & Audit
    ticket = tickets[0]
    ticket_id = ticket["id"]
    print(f"\n[6] Submitting evidence for Ticket #{ticket_id}: '{ticket['title']}'...")
    
    # Create matching evidence text based on task description to pass the audit
    evidence_text = (
        "Compliance Evidence Report:\n"
        f"Regarding the task: {ticket['description']}\n"
        "We have fully implemented the security guidelines. The encryption checks show AES-256 standard is activated. "
        "Liquidity requirements are rebalanced in accordance with the regulatory audit report."
    )
    
    data = {"evidence_text": evidence_text}
    res = requests.post(f"{API_BASE}/tickets/{ticket_id}/submit-evidence", data=data)
    assert res.status_code == 200, f"Submit evidence failed: {res.text}"
    audit_res = res.json()
    print("Audit response:", audit_res)
    assert "audit_passed" in audit_res
    assert "audit_score" in audit_res
    
    # 7. Test Audit Loop Recheck
    print("\n[7] Testing POST /api/audit-loop...")
    res = requests.post(f"{API_BASE}/audit-loop")
    assert res.status_code == 200
    loop_res = res.json()
    print("Audit loop result:", loop_res)
    
    print("\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    run_tests()
