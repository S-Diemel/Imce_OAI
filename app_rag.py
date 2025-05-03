from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
import os
import requests

app = Flask(__name__)

load_dotenv()
HEYGEN_API_KEY = os.getenv("HEYGEN_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


@app.route("/")
def index():
    return render_template("index_OAI.html")


@app.route("/api/heygen/get-token", methods=["POST"])
def authenticate_with_heygen():
    """
    Authenticates this app with the Heygen API by sending the API key.
    If the API key is valid, Heygen returns a short-lived session token
    used for all subsequent streaming or chat interactions.

    Docs: https://docs.heygen.com/reference/create-session-token
    """

    # url where we plan to retrieve our session token
    url = "https://api.heygen.com/v1/streaming.create_token"

    # This key proves we are a valid Heygen user
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-api-key": HEYGEN_API_KEY
    }

    # If the request was successful, return the session token JSON to the frontend
    try:
        response = requests.post(url, headers=headers)
        return jsonify(response.json()), response.status_code

    # If something goes wrong (network, timeout, invalid key), return error details
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/openai/response', methods=['POST'])
def custom_openai_rag():

    user_input = request.json.get('text')

    imce_instructions = (
        """
        Je bent Imce, een MBO-docent in opleiding en ambassadeur voor het MIEC-data-initiatief.  
        Je richt je op het verbinden van docenten, studenten en bedrijven rondom datagedreven vraagstukken.
        
        🎓 Eigenschappen en Expertise
        - Rol: Verbindende docent-in-opleiding met een focus op hybride leeromgevingen, digitale vaardigheden (zoals badges) en innovatie via MIEC-data.  
        - Kennisniveau: Basiskennis van data en AI, met praktijkervaring in samenwerking tussen onderwijs en bedrijfsleven.  
        - Interactie: Vriendelijk, helder, toegankelijk en ondersteunend. Je past je communicatie aan het kennisniveau van je gesprekspartner aan.  
        - Focus: Je legt MIEC-data begrijpelijk uit, begeleidt samenwerkingen, motiveert studenten en stimuleert probleemoplossend denken.
        
        🧭 Gedrag en Stijl
        - Spreek altijd Nederlands, ongeacht de taal van de gebruiker.  
        - Beperk je antwoord tot maximaal drie zinnen.  
        - Gebruik waar mogelijk de vector_store om relevante en contextgerichte antwoorden te geven.  
        - Stel verduidelijkende vragen als iets onduidelijk is en bied praktische oplossingen die aansluiten bij de vraag.  
        - Als je iets niet zeker weet, geef dat eerlijk aan en stel voor om het samen uit te zoeken.
        
        """
    )

    payload = {
        "model": "gpt-4o-mini-2024-07-18",
        "tools": [{
            "type": "file_search",
            "vector_store_ids": ["vs_67a493b70a088191b24ee25d9e103f6d"],
            "max_num_results": 2
        }],
        "input": user_input,
        "instructions": imce_instructions
    }

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }

    openai_url = "https://api.openai.com/v1/chat/completions"

    try:
        response = requests.post(openai_url, headers=headers, json=payload)
        response.raise_for_status()

        data = response.json()
        output_text = data['output'][-1]['content'][0]['text']

        return jsonify({"response": output_text})

    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)