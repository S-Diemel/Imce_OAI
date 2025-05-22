from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
import os
import requests
import re

app = Flask(__name__)

load_dotenv()
HEYGEN_API_KEY = os.getenv("HEYGEN_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
vector_store_id = "vs_67a493b70a088191b24ee25d9e103f6d"
subjects = [
    "data", "dataset", "gegevens", "big data", "database", "kunstmatige intelligentie", "AI",
            "artificial intelligence", "machine learning", "ML", "algoritme", "algoritmes",
            "deep learning", "neurale netwerken", "digitale vaardigheden", "ICT", "clouddiensten",
            "cloud computing", "cloudopslag", "apps", "software", "applicaties", "tools", "AVG",
            "privacy", "persoonsgegevens", "gegevensbescherming", "digitale voetafdruk", "dataspoor",
            "metadata", "dataveiligheid", "cybersecurity", "phishing", "hackers", "wachtwoord",
            "tweefactorauthenticatie", "beveiliging", "datalek", "cookies", "tracking cookies",
            "advertentieprofilering", "targeted ads", "social media", "online gedrag",
            "online identiteit", "digitale identiteit", "adblocker", "browser-extensie", "AI-ethiek",
            "bias", "eerlijkheid", "discriminatie", "accountability", "transparantie",
            "betrouwbaarheid", "verantwoord gebruik", "modeloptimalisatie", "micro-modules",
            "leerpad", "kennischeck", "quiz", "badges", "leerroute", "module", "bewijs van deelname",
            "certificaat", "chatbot", "praktijkvoorbeeld", "aanbevelingssysteem", "spraakherkenning",
            "automatische vertaling", "tracking", "gedragsanalyse", "advertentietracking",
            "algoritmen", "leiderschap"
]

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

def vector_store_search(query):
    endpoint = f"https://api.openai.com/v1/vector_stores/{vector_store_id}/search"
    payload = {
        "query": query,
        "max_num_results": 3,
        "rewrite_query": False,
        "ranking_options": {
            "score_threshold": 0.7
        }

    }
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }

    response = requests.post(endpoint, headers=headers, json=payload)
    response.raise_for_status()
    context = "Dit is de context waarop je het antwoord moet baseren: \n "

    if len(response.json()['data'])==0:
        return '\ngeef aan dat je geen informatie hebt over het de vraag en moedig de student aan om een andere vraag te stellen.'

    for i, result in enumerate(response.json()['data']):
        content = f"{i+1}: {result['content'][0]['text']} \n "
        context += content
    return context

def vector_store_search_check(user_input):
    instructions = (
        f"""
        Je bent een AI die uitsluitend antwoordt met "ja" of "nee" op basis van strikt vastgestelde criteria. Beantwoord een vraag of opmerking uitsluitend met het woord "ja" als één of meer van de onderstaande situaties van toepassing is:

        1. Er wordt om specifieke informatie gevraagd.
        
        2. Het betreft een inhoudelijke vraag over een onderwerp.
        
        3. Er wordt gevraagd om verduidelijking of uitleg.
        
        4. als de inhoud is gerelateerd aan een van deze onderwerpen: {subjects}
        
        In alle andere gevallen, geef uitsluitend het antwoord "nee".
        
        Je mag geen andere uitleg, verduidelijking of aanvullende informatie geven. Gebruik alleen het woord "ja" of "nee" in je antwoord.
        
        Als een vraag niet duidelijk binnen de criteria valt, antwoord dan met "nee".

        """
    )
    payload = {
        "model": "gpt-4.1-mini-2025-04-14",
        "input": user_input,
        "instructions": instructions
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
        if re.search(r'\bja\.?\b', output_text, re.IGNORECASE):
            return True
        else:
            return False

    except requests.RequestException as e:
        return False

def custom_rag(user_input):
    imce_instructions = (
        """
        Je bent Imce, een MBO-docent en ambassadeur voor het MIEC-data-initiatief.
        Je helpt studenten, docenten en bedrijven met vragen over data, kunstmatige intelligentie (AI) en digitale vaardigheden. Je denkt mee, geeft uitleg in begrijpelijke taal (niveau MBO 3-4), ondersteunt bij het leren en bent een sparringpartner als dat nodig is. Ook verbind je mensen en organisaties rondom datagedreven vraagstukken.
        
        
        Eigenschappen en expertise
        - Rol: Deskundige en toegankelijke MBO-docent met focus op hybride leeromgevingen, digitale vaardigheden (zoals badges), innovatie met MIEC-data en het leggen van verbindingen tussen onderwijs en bedrijfsleven.
        - Kennisniveau: Kennis van data en AI, met praktijkervaring in samenwerking tussen onderwijs en bedrijfsleven.
        - Interactie: Vriendelijk, helder, toegankelijk en ondersteunend. Je stemt je communicatie altijd af op het kennisniveau van je gesprekspartner.
        - Focus: Je legt data en AI begrijpelijk uit, helpt bij het leren, motiveert studenten, denkt actief mee en stimuleert probleemoplossend denken.
        
        Gedrag en stijl
        - Houd je antwoorden kort en duidelijk.
        - Beperk je tot de gegeven context.
        - Niet alle context hoeft in het antwoord, alleen wat relevant is.
        - Stel verduidelijkende vragen als iets onduidelijk is en bied praktische oplossingen die passen bij de vraag.
        - Als je iets niet zeker weet, geef dat eerlijk aan en stel voor om het samen uit te zoeken.
        - Moedig gebruikers aan om door te vragen als ze meer willen weten.
        
        Voorbeeldzinnen voor communicatie:
        - “Fijn dat je dit vraagt! Zal ik het stap voor stap uitleggen of wil je eerst zelf iets proberen?”
        - “Ik weet hier het antwoord niet direct op, maar we kunnen het samen uitzoeken als je wilt.”
        - “Heb je nog een andere vraag, of zal ik een voorbeeld geven zodat het duidelijker wordt?”
        """
    )
    if vector_store_search_check(user_input):
        print('file search')
        query = user_input[-1]['content']
        context = vector_store_search(query)
        user_input[-1]['content'] = query + '\n' + context

    payload = {
        "model": "gpt-4o-mini-2024-07-18",
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

        return {"response": output_text}

    except requests.RequestException as e:
        return {"error": str(e)}, 500


@app.route('/api/openai/response', methods=['POST'])
def call_custom_rag():
    user_input = request.json.get('text')
    output = custom_rag(user_input)
    return jsonify(output)



if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)