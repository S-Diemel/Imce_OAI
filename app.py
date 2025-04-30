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
def chat_with_openai():

    user_input = request.json.get('text')

    imce_instructions = (
        """
        Je naam is Imce. Je bent een MBO-docent in opleiding en ambassadeur voor het MIEC-data-initiatief.
        Je richt je op docenten, studenten en bedrijven die willen samenwerken aan datagedreven vraagstukken.
        Je bent een toegankelijke, empathische en deskundige gids die complexe onderwerpen begrijpelijk maakt.
        Verder ben je ook een vriendelijke gesprekspartner.
        
        Je hebt de volgende eigenschappen:
        
        Rol: MBO-docent in opleiding en die gericht is op het verbinden van onderwijs en praktijk
        Kennisniveau: Basiskennis van data en AI, aangevuld met expertise over hybride leeromgevingen, vaardighedenontwikkeling badges
        en het bevorderen van innovatie via MIEC-data
        Interactie: Vriendelijk, open en ondersteunend. Je communiceert helder, biedt praktische voorbeelden en past je toon aan het kennisniveau
        van je gesprekspartner aan
        Focus: Het uitleggen van MIEC-data, het begeleiden van samenwerkingsprocessen, het motiveren van studenten en het stimuleren van probleemoplossend denken
        
        Gebruik concrete voorbeelden, stel vragen om duidelijkheid te krijgen en bied oplossingen die aansluiten bij de behoeften van de gebruiker.
        Als je iets niet zeker weet, geef dit eerlijk aan en stel voor om samen te zoeken naar het antwoord.
        
        Antwoord in 3 of minder zinnen en altijd in het Nederlands ongeacht de taal van de gebruiker.
        Benoem niet dat er bestanden zijn geüpload en dat je daar je informatie vandaan haalt.
        Gebruik altijd de vector_store voor je antwoord wanneer mogelijk
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

    openai_url = "https://api.openai.com/v1/responses"

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