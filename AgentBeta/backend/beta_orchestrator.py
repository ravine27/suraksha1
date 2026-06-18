import os
import json
import requests
import sqlite3
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Get database path dynamically
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sentinel_regai.db")

def get_api_key():
    """Retrieves the Gemini API Key from SQLite settings or environment variables."""
    # Try environment variable first
    key = os.getenv("GEMINI_API_KEY")
    if key:
        return key
    
    # Try DB settings
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'gemini_api_key'")
            row = cursor.fetchone()
            conn.close()
            if row and row['value'].strip():
                return row['value'].strip()
        except Exception as e:
            print("Error loading API key from DB:", e)
            
    return None

def call_gemini(prompt, response_schema=None):
    """Sends a prompt to the Gemini API using requests and returns the parsed JSON response.
    Returns None if the call fails or no API key is set.
    """
    api_key = get_api_key()
    if not api_key:
        return None
    
    # Using gemini-1.5-flash as the default model
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    headers = {
        "Content-Type": "application/json"
    }
    
    payload = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=15)
        if response.status_code == 200:
            res_data = response.json()
            # Extract text from response structure
            text_out = res_data['candidates'][0]['content']['parts'][0]['text']
            return json.loads(text_out)
        else:
            print(f"Gemini API error (Status {response.status_code}): {response.text}")
            return None
    except Exception as e:
        print("Exception during Gemini API call:", e)
        return None

class BetaOrchestrator:
    def __init__(self):
        pass

    def generate_map(self, alert_text):
        """Generates a structured title and MAP description for an alert.
        Uses Gemini API if available, otherwise falls back to keyword-based heuristics.
        """
        api_key = get_api_key()
        if api_key:
            prompt = f"""
            You are Agent Beta, the Compliance Orchestrator.
            Turn the following raw regulatory/compliance text into a concrete, actionable "Measurable Action Point" (MAP) for bank employees.
            
            Text: "{alert_text}"
            
            Provide your response in JSON format with exactly the following keys:
            - "title": A short, clear task title (e.g., "Implement AES-256 encryption")
            - "map_description": A detailed, explicit, operational instruction specifying what compliance evidence needs to be submitted.
            
            JSON Output:
            """
            result = call_gemini(prompt)
            if result and "title" in result and "map_description" in result:
                return result["title"], result["map_description"]
        
        # Fallback local generator
        text_lower = alert_text.lower()
        if any(w in text_lower for w in ["cyber", "security", "encryption", "aes", "auth", "mfa", "hackathon"]):
            title = "Implement Cyber & Security Controls"
            description = (
                "Mandatory Security Action: Deploy AES-256 encryption for all sensitive PII data fields. "
                "Configure Multi-Factor Authentication (MFA) across all employee access portals. "
                "Provide a screenshot of the MFA configuration panel or a system logs document showing active AES-256 validation."
            )
        elif any(w in text_lower for w in ["train", "hire", "employee", "hr", "conduct", "staff"]):
            title = "Enforce HR Policy & Employee Training"
            description = (
                "Mandatory HR Compliance Action: Distribute the updated compliance guidelines and Code of Conduct. "
                "Organize and log a mandatory training program for all branch managers. "
                "Submit the training attendance sheet or employee training completion log as evidence."
            )
        elif any(w in text_lower for w in ["audit", "contract", "filing", "legal", "gdpr", "privacy", "regulation"]):
            title = "Conduct Legal & Compliance Audits"
            description = (
                "Mandatory Legal Compliance Action: Review third-party data processing contracts. "
                "Draft the compliance statement for the regulatory board. "
                "Upload a signed copy of the compliance checklist or a legal audit report document."
            )
        elif any(w in text_lower for w in ["liquidity", "capital", "treasury", "reserve", "forex", "asset"]):
            title = "Manage Treasury Liquidity & Reserves"
            description = (
                "Mandatory Treasury Action: Update the asset-liability matching stress test parameters. "
                "Rebalance the branch capital reserves to comply with revised liquidity ratios. "
                "Submit a copy of the updated liquidity coverage ratio calculation sheet."
            )
        else:
            title = "General Compliance Action Item"
            description = (
                "Analyze the regulatory alert, compile the required documentation, "
                "and distribute the updated compliance directives to relevant operational teams. "
                "Upload a PDF showing the email distribution list or updated compliance circular."
            )
            
        return title, description

    def route_task(self, map_description):
        """Routes the MAP description to the most appropriate department (IT, HR, Legal, Treasury)
        using Cosine Similarity logic against department profiles saved in settings.
        """
        # Load department skill matrices from DB
        departments = ['IT', 'HR', 'Legal', 'Treasury']
        profiles = {}
        
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            for dept in departments:
                cursor.execute("SELECT value FROM settings WHERE key = ?", (f"skills_{dept}",))
                row = cursor.fetchone()
                if row:
                    profiles[dept] = row['value']
                else:
                    profiles[dept] = ""
            conn.close()
        except Exception as e:
            print("Error loading department profiles for routing:", e)
            # Default profiles
            profiles = {
                'IT': 'cybersecurity data encryption AES-256 cloud systems firewall access control authentication API security network vulnerability patch management protocol HTTPS SSL TLS',
                'HR': 'employee training hiring onboarding policy dissemination staff compliance benefits payroll labor laws workplace safety code of conduct',
                'Legal': 'compliance audits contracts review regulatory filings litigation GDPR data privacy laws SEC disclosures disclosure advisory policy drafting',
                'Treasury': 'capital adequacy liquidity risk asset liability management forex currency reserve banking audit balance sheet cost control funding capital requirements'
            }

        # Vectorize using TF-IDF
        texts = [map_description] + [profiles[dept] for dept in departments]
        vectorizer = TfidfVectorizer()
        tfidf = vectorizer.fit_transform(texts)
        
        # Calculate cosine similarity
        map_vec = tfidf[0:1]
        dept_vecs = tfidf[1:]
        
        similarities = cosine_similarity(map_vec, dept_vecs)[0]
        
        # Find index of max similarity
        max_idx = similarities.argmax()
        matched_dept = departments[max_idx]
        score = float(similarities[max_idx])
        
        # If score is 0, default to Legal
        if score == 0:
            matched_dept = 'Legal'
            
        return matched_dept, score

    def audit_evidence(self, map_description, evidence_text):
        """Audits the submitted employee evidence text against the MAP description.
        Uses Gemini API if available, otherwise falls back to a semantic TF-IDF scoring model.
        """
        api_key = get_api_key()
        if api_key:
            prompt = f"""
            You are Agent Beta, the Compliance Auditor.
            Evaluate if the employee-submitted compliance evidence text satisfies the requirements of the Measurable Action Point (MAP).
            
            MAP Requirements: "{map_description}"
            Employee Evidence Submitted: "{evidence_text}"
            
            Provide your response in JSON format with exactly the following keys:
            - "passed": boolean (true if the evidence satisfies the MAP, false otherwise)
            - "score": number between 0.00 and 1.00 indicating the degree of completeness and matching.
            - "feedback": a detailed summary explaining why it passed or failed and what (if anything) is missing.
            
            JSON Output:
            """
            result = call_gemini(prompt)
            if result and "passed" in result and "score" in result and "feedback" in result:
                return bool(result["passed"]), float(result["score"]), str(result["feedback"])

        # Fallback local auditing
        vectorizer = TfidfVectorizer()
        try:
            tfidf = vectorizer.fit_transform([map_description, evidence_text])
            sim = float(cosine_similarity(tfidf[0:1], tfidf[1:2])[0][0])
        except Exception as e:
            print("Error in local similarity audit:", e)
            sim = 0.0

        # Adjust score mapping for TF-IDF cosine similarity
        # Cosine similarity for text is often low, so we set threshold at 0.20
        passed = sim >= 0.20
        audit_score = min(1.0, sim / 0.50) if sim > 0 else 0.0
        
        if passed:
            feedback = (
                f"Local Audit Verification: The submitted evidence contains relevant semantic matches "
                f"(TF-IDF Cosine Similarity: {sim:.4f}, Scaled Score: {audit_score:.2f}). "
                f"Critical terms align with the requirements of the MAP. Task verified successfully."
            )
        else:
            feedback = (
                f"Local Audit Verification: The submitted evidence does not show sufficient semantic overlap "
                f"(TF-IDF Cosine Similarity: {sim:.4f}, Scaled Score: {audit_score:.2f}). "
                f"The text appears unrelated or lacks required operational details specified in the MAP. "
                f"Please review the MAP and resubmit appropriate evidence."
            )
            
        return passed, audit_score, feedback

if __name__ == "__main__":
    # Test routing & fallback MAP generation
    orchestrator = BetaOrchestrator()
    
    test_alert = "All branches must rebalance their cash reserves and check capital requirements according to RBI's liquidity management plan."
    title, map_desc = orchestrator.generate_map(test_alert)
    print("Generated MAP:")
    print("Title:", title)
    print("Description:", map_desc)
    
    dept, score = orchestrator.route_task(map_desc)
    print(f"\nRouted to: {dept} (Similarity Score: {score:.4f})")
    
    # Test evidence auditing
    test_evidence_pass = "We have completed the rebalancing of branch capital reserves. The liquidity coverage ratio calculation sheet has been updated with new values."
    test_evidence_fail = "The team had a meeting to discuss customer service updates."
    
    passed_1, score_1, feedback_1 = orchestrator.audit_evidence(map_desc, test_evidence_pass)
    print(f"\nAudit 1 (Pass Case) -> Passed: {passed_1}, Score: {score_1:.2f}")
    print("Feedback:", feedback_1)
    
    passed_2, score_2, feedback_2 = orchestrator.audit_evidence(map_desc, test_evidence_fail)
    print(f"\nAudit 2 (Fail Case) -> Passed: {passed_2}, Score: {score_2:.2f}")
    print("Feedback:", feedback_2)
