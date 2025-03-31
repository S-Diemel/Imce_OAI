from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
import os
import requests

load_dotenv()
app = Flask(__name__)
HEYGEN_API_KEY = os.getenv("HEYGEN_API_KEY")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/get-token", methods=["POST"])
def get_token():
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": HEYGEN_API_KEY
    }
    try:
        response = requests.post("https://api.heygen.com/v1/streaming.create_token", headers=headers)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)