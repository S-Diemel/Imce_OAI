from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
import requests
import re
import os, sys
import webbrowser, threading, time
from pathlib import Path


def app_base_dir() -> Path:
    # PyInstaller onefile: tijdelijke uitpakmap
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    # Normale .py run
    try:
        return Path(__file__).resolve().parent
    except NameError:
        # IPython/Jupyter: geen __file__; val terug op current working dir
        return Path.cwd()

BASE = app_base_dir()

def resource_path(*parts) -> str:
    return str(BASE.joinpath(*parts))


# Initialize the Flask application
app = Flask(
    __name__,
    static_folder=resource_path("static"),
    template_folder=resource_path("templates")
)

# Load environment variables from a .env file
def load_embedded_env():
    env_file = resource_path('.env')
    if os.path.exists(env_file):
        load_dotenv(dotenv_path=env_file, override=False)

load_embedded_env()

# Retrieve API keys and configuration from environment variables
HEYGEN_API_KEY = os.getenv("HEYGEN_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
VECTOR_STORE_ID = os.getenv("VECTOR_STORE_ID")
vector_store_used = True
use_vector_store_check = True

# List of subjects to be used for vector store relevance checks
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
    """
    Render the main HTML page.

    This route returns the 'index.html' template to be served to the client
    when they visit the root URL of the application.
    """
    return render_template("index.html")


@app.route("/api/heygen/get-token", methods=["POST"])
def authenticate_with_heygen():
    """
    Authenticate with the Heygen API and retrieve a session token.

    Sends a POST request with the HEYGEN_API_KEY to the Heygen
    streaming.create_token endpoint. If successful, returns the JSON
    response containing a short-lived session token for subsequent
    Heygen API calls. In case of an error, returns an error message.

    Docs: https://docs.heygen.com/reference/create-session-token
    """
    # URL to request a session token from Heygen
    url = "https://api.heygen.com/v1/streaming.create_token"

    # Headers to include the Heygen API key for authentication
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-api-key": HEYGEN_API_KEY
    }

    try:
        # Send the POST request to Heygen
        response = requests.post(url, headers=headers)
        # Return the JSON response from Heygen along with its status code
        return jsonify(response.json()), response.status_code

    except Exception as e:
        # In case of network issues or invalid key, return a 500 error with details
        return jsonify({"error": str(e)}), 500


def vector_store_search(query):
    """
    Perform a semantic search against the OpenAI Vector Store.

    Given a query string, this function sends a request to the OpenAI
    Vector Store API to retrieve up to 3 most relevant documents. If no
    results are found, returns a message indicating lack of information.

    Args:
        query (str): The user's search query.

    Returns:
        str: A string containing the concatenated context from top results,
             or a message encouraging the user to ask another question if
             no relevant results are found.
    """
    endpoint = f"https://api.openai.com/v1/vector_stores/{VECTOR_STORE_ID}/search"
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

    # Send the POST request to the Vector Store API
    response = requests.post(endpoint, headers=headers, json=payload)
    response.raise_for_status()  # Raise an exception if the request failed

    # Start constructing the context string
    context = "Dit is de context waarop je het antwoord moet baseren: \n "

    # If no results are returned, inform the user that no info is available
    if len(response.json().get('data', [])) == 0:
        no_results_instructions = '\ngeef aan dat je geen informatie hebt over het de vraag en moedig de student aan om een andere vraag te stellen.'
        return no_results_instructions

    # Iterate through the results and append their content to the context
    for i, result in enumerate(response.json()['data']):
        # Extract the text from each result and add it to the context
        content = f"{i + 1}: {result['content'][0]['text']} \n "
        context += content

    return context


def vector_store_search_check(user_input):
    """
    Determine if the user's input should trigger a vector store search.

    This function sends the user's input and a set of instructions
    to the OpenAI API (using a specialized 'gpt-4.1-mini-2025-04-14' model)
    to receive a simple 'ja' or 'nee' response. 'Ja' indicates that:
        1. Specific information is requested.
        2. It is a substantive question about a topic.
        3. Clarification or explanation is requested.
        4. The content relates to any of the listed subjects.

    Returns True if 'ja' was returned by the model, otherwise False.

    Args:
        user_input (str): The text input from the user.

    Returns:
        bool: True if a vector store search should be performed, False otherwise.
    """
    search_check_instructions = (
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
    vector_store_search_model = "gpt-4.1-mini-2025-04-14"
    payload = {
        "model": vector_store_search_model,
        "input": user_input,
        "instructions": search_check_instructions
    }
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    openai_url = "https://api.openai.com/v1/responses"

    try:
        # Send the request to OpenAI to get 'ja' or 'nee'
        response = requests.post(openai_url, headers=headers, json=payload)
        response.raise_for_status()

        data = response.json()
        output_text = data['output'][-1]['content'][0]['text']
        # Check if 'ja' is present in the response (case-insensitive)
        if re.search(r'\bja\.?\b', output_text, re.IGNORECASE):
            return True
        else:
            return False

    except requests.RequestException:
        # In case of an error with the request, default to False
        return False


def custom_rag(user_input):
    """
    Custom Retrieval-Augmented Generation (RAG) workflow.

    This function acts as the core logic for processing user input.
    - It first defines instructions for the RAG agent ('Imce') to behave
      as an MBO-docent (teacher) focused on data, AI, and digital skills.
    - It checks whether the input warrants a vector store search using
      vector_store_search_check. If so, it retrieves additional context
      from the vector store and appends it to the user's query.
    - It sends the final user_input (possibly augmented with context) to
      the OpenAI API using a 'gpt-4o-mini-2024-07-18' model and returns
      the model's response or an error message.

    Args:
        user_input (list of dict): A list of message objects, each containing
                                   'role' and 'content' keys for the conversation.

    Returns:
        dict: A dictionary containing the RAG model's response under 'response',
              or an error string under 'error' if something went wrong.
    """
    # Define the RAG agent's persona, instructions, and behavior
    imce_instructions = (
        """
        Je bent Sem van Beethoven, de virtuele gids van Project Beethoven. Jij beantwoordt vragen over het project, het Nationaal Versterkingsplan Microchip Talent en het lonkende perspectief van talentontwikkeling en ecosystemen in Zuid-Nederland richting 2040.


        Karakter en persona:
        
        · Vastberaden: je spreekt met overtuiging en helderheid.
        
        · Innovatief: je verbindt feiten met vernieuwende ideeën en schetst toekomstscenario’s.
        
        · Visionair: je kijkt altijd vooruit, naar 2030 en vooral naar 2040.
        
        · Je staat symbool voor het doorbreken van grenzen, net zoals Beethoven dat in de muziek deed.
        
        · Je bent geen stoffige historische figuur, maar een avatar die de brug vormt tussen technologie en menselijkheid, midden in de toekomst.
        
        
        Doelgroepen: Je richt je op bestuurders, directieleden, docenten en bedrijven. Voor ieder van deze groepen vertaal je de betekenis van Beethoven op een manier die aansluit bij hun rol:
        
        · Bestuurders en directie: strategisch perspectief, governance en lange termijn impact.
        
        · Docenten: onderwijsvernieuwing, hybride leeromgevingen en rol in Leven Lang Ontwikkelen.
        
        · Bedrijven: aansluiting onderwijs-arbeidsmarkt, instroom en behoud van talent, samenwerking in labs en fieldlabs.
        
        
        Rol en stijl:
        
        · Deskundig en feitelijk, gebaseerd op de officiële plannen en afspraken (Project Beethoven en het Nationaal Versterkingsplan Microchip Talent).
        
        · Inspirerend en toekomstgericht: je laat zien hoe investeringen van nu leiden tot een veerkrachtig en inclusief ecosysteem in 2040.
        
        · Toegankelijk: je legt complexe zaken uit in begrijpelijke taal.
        
        · Verbindend: je benadrukt samenwerking tussen onderwijs, overheid, bedrijven en samenleving.
        
        · Je spreekt de gebruiker altijd aan met ‘je/jij’
        
        
        Kennisbasis:
        
        · Project Beethoven is een nationale investering van 2,51 miljard euro (besluit Raad van Ministers, 28 maart 2024) om de groei van de microchipsector te ondersteunen en de kwaliteit van leven in Brabant te versterken.
        
        · De naam Beethoven verwijst naar Brainport Eindhoven als zwaartepunt van de groei en de kracht om grenzen te doorbreken.
        
        · Een kernonderdeel is het Nationaal Versterkingsplan Microchip Talent: €450 miljoen tot 2030 en vanaf 2031 structureel €80 miljoen per jaar voor talentontwikkeling.
        
        · De opgave: tot 2030 zijn er 38.000 extra technici nodig, waarvan circa 26.000 in Brainport.
        
        · Vier regio’s zijn betrokken: Brainport, Zuid-Holland (Delft), Twente en Noord-Nederland (Groningen).
        
        · Kernpijlers: human capital, Leven Lang Ontwikkelen (LLO), internationale werving en retentie, infrastructuur (labs, cleanrooms), en een aantrekkelijk vestigingsklimaat.
        
        · Monitoring: PTvT coördineert de lerende monitoring en peer reviews; RVO bewaakt de formele subsidieverantwoording.
        
        
        Zuid-Nederland als kernregio:
        
        · Zuid-Nederland is de motor van Beethoven. Hier is de vraag naar technici het grootst en hier nemen mbo-instellingen een sleutelrol op zich.
        
        · Het mbo transformeert van opleider naar strategisch ecosysteempartner: met hybride leerplekken, modulair onderwijs en een stevig aanbod voor LLO.
        
        · De regio staat model voor hoe onderwijs, bedrijven en overheid samen leren, werken en innoveren.
        
        
        Visie 2040 – het lonkend perspectief:
        
        · Zuid-Nederland is in 2040 een wereldwijd toonaangevend skills-ecosysteem.
        
        · Onderwijs is flexibel en modulair, iedereen kan een leven lang leren en ontwikkelen.
        
        · Bedrijven en onderwijs werken structureel samen in labs, fieldlabs en communities.
        
        · Talentontwikkeling is inclusief: iedereen kan instromen en doorgroeien, ongeacht achtergrond.
        
        · Internationaal talent wordt niet alleen aangetrokken maar ook behouden, mede door een sterke leefomgeving.
        
        · Het ecosysteem draagt bij aan brede welvaart, technologische innovatie en maatschappelijke vooruitgang.
        
        · Samen leren, werken en innoveren leidt tot zichtbare effecten en voortdurende reflectie en verbetering.
        
        
        Manier van antwoorden:
        
        · Combineer feiten en cijfers met inspirerende perspectieven.
        
        · Als iemand vraagt naar details (budgetten, aantallen, monitoring), antwoord je feitelijk.
        
        · Als iemand vraagt naar de toekomst, vertel je een visionair verhaal dat technologie en menselijkheid verbindt.
        
        · Benadruk steeds de gezamenlijke beweging: onderwijs, bedrijfsleven en overheid creëren samen impact.
        
        · Tutoyeer altijd (‘je/jij’).
        
        
        Omgaan met onbekende vragen:
        
        · Als de informatie niet in de systeemprompt of database staat, zeg dit expliciet.
        
        · Voorbeeld: “Dat weet ik niet precies, die informatie heb ik niet beschikbaar.
        
        · Stel altijd een terugvraag om het gesprek verder te brengen.
        
        · Vermijd speculatie of aannames.
        """
    )

    # Check if the vector store is used for this module
    if vector_store_used:
        # Check if we need to perform a vector store search for the latest message
        if vector_store_search_check(user_input) or not use_vector_store_check:
            print('file search')  # Debug logging indicating a search was triggered
            query = user_input[-1]['content']  # Extract the latest message content
            # Retrieve context from the vector store
            context = vector_store_search(query)
            # Append retrieved context to the user's original query
            user_input[-1]['content'] = query + '\n' + context

    rag_model = "gpt-4o-mini-2024-07-18"
    payload = {
        "model": rag_model,
        "input": user_input,
        "instructions": imce_instructions
    }
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    openai_url = "https://api.openai.com/v1/responses"

    try:
        # Send the request to OpenAI to get the RAG response
        response = requests.post(openai_url, headers=headers, json=payload)
        response.raise_for_status()

        data = response.json()
        output_text = data['output'][-1]['content'][0]['text']

        return {"response": output_text}

    except requests.RequestException as e:
        # If there's an error with the request, return the error message
        return {"error": str(e)}, 500


@app.route('/api/openai/response', methods=['POST'])
def call_custom_rag():
    """
    HTTP endpoint to process user input via the custom RAG pipeline.

    Expects a JSON payload with a 'text' field containing the conversation
    history. Passes this to `custom_rag` and returns the model output as JSON.

    Returns:
        A JSON response containing either:
          - 'response': The text output from the RAG model.
          - 'error': Error details if the request to OpenAI failed.
    """
    user_input = request.json.get('text')
    output = custom_rag(user_input)
    return jsonify(output)


def open_browser(port):
    time.sleep(0.6)
    webbrowser.open(f"http://127.0.0.1:{port}")


if __name__ == "__main__":
    # Run the Flask development server on port 8000, accessible from any host
    from waitress import serve
    # choose an open port, or make it configurable
    port = int(os.environ.get("PORT", "7860"))
    print(f"Starting server on http://127.0.0.1:{port}")
    threading.Thread(target=open_browser, args=(port,), daemon=True).start()
    serve(app, host="127.0.0.1", port=port)
