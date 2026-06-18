import os
import pypdf
import torch
from transformers import BertForSequenceClassification, AutoTokenizer

DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
    "agent_alpha_gold_master (1)"
)

class AlphaScanner:
    def __init__(self, model_path=DEFAULT_MODEL_PATH):
        self.model_path = model_path
        print(f"Loading Agent Alpha BERT model from: {self.model_path}")
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_path)
        self.model = BertForSequenceClassification.from_pretrained(self.model_path)
        self.model.eval()

    def extract_text_from_pdf(self, pdf_path):
        """Extracts text page-by-page from the given PDF file."""
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")
        
        reader = pypdf.PdfReader(pdf_path)
        pages_text = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text:
                pages_text.append(text)
        return pages_text

    def segment_text(self, pages_text):
        """Splits the raw page text into clean paragraphs/segments."""
        segments = []
        for page_num, page_text in enumerate(pages_text, 1):
            # Split by double newlines or lines that look like separate paragraphs
            lines = page_text.split("\n")
            current_segment = []
            
            for line in lines:
                line_stripped = line.strip()
                if not line_stripped:
                    if current_segment:
                        seg_text = " ".join(current_segment).strip()
                        # Filter out very short segments (e.g. headers, footers, page numbers)
                        if len(seg_text) > 30:
                            segments.append({
                                "content": seg_text,
                                "page": page_num
                            })
                        current_segment = []
                else:
                    # Check if line seems to be a page header or page number and skip
                    if line_stripped.lower().startswith("page") and len(line_stripped) < 15:
                        continue
                    current_segment.append(line_stripped)
            
            if current_segment:
                seg_text = " ".join(current_segment).strip()
                if len(seg_text) > 30:
                    segments.append({
                        "content": seg_text,
                        "page": page_num
                    })
                    
        return segments

    def score_segment(self, segment_text):
        """Tokenizes and scores a single segment using the BERT model.
        Returns the Rscore (probability of class 1 / regulatory alert).
        """
        inputs = self.tokenizer(
            segment_text, 
            return_tensors="pt", 
            truncation=True, 
            max_length=512
        )
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        logits = outputs.logits
        probs = torch.softmax(logits, dim=1).numpy()[0]
        # Class 1 is regulatory alert, Class 0 is BAU
        rscore = float(probs[1])
        return rscore

    def scan_document(self, pdf_path, threshold=0.50):
        """Runs the entire ingestion and scanning pipeline for a document."""
        pages_text = self.extract_text_from_pdf(pdf_path)
        raw_segments = self.segment_text(pages_text)
        
        scanned_results = []
        for seg in raw_segments:
            content = seg["content"]
            page = seg["page"]
            rscore = self.score_segment(content)
            is_escalated = rscore >= threshold
            
            scanned_results.append({
                "content": content,
                "page": page,
                "rscore": rscore,
                "is_escalated": is_escalated
            })
            
        return scanned_results

if __name__ == "__main__":
    # Test scanner on BankSavers.pdf
    pdf_file = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
        "BankSavers.pdf"
    )
    scanner = AlphaScanner()
    results = scanner.scan_document(pdf_file, threshold=0.50)
    
    escalated_count = sum(1 for r in results if r["is_escalated"])
    print(f"\nScanned {len(results)} segments. Escalated {escalated_count} anomalies.")
    
    print("\nTop 3 Escalated Alerts:")
    escalated_items = [r for r in results if r["is_escalated"]]
    for i, r in enumerate(escalated_items[:3], 1):
        print(f"\nAlert #{i} (Page {r['page']}, Rscore: {r['rscore']:.4f}):")
        print(r['content'][:150] + "...")
