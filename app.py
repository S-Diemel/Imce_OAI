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
    return render_template("index.html")


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


@app.route("/api/openai/chat", methods=["POST"])
def get_openai_token():

    # Creating a Session token
    # https://platform.openai.com/docs/api-reference/responses/create?lang=curl

    url = "https://api.openai.com/v1/responses"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }

    # Send the POST request to Heygen's API to create a new session token
    try:

        # Read the JSON data sent from the frontend (like the user's message or query)
        payload = request.get_json()

        # Send the POST request to OpenAI with both headers and user input
        response = requests.post(url, headers=headers, json=payload)

        # Return the JSON response from OpenAI to your frontend, along with status code
        return jsonify(response.json()), response.status_code

    except Exception as e:

        # Catch any errors (network, bad payload, etc.) and return a 500 error with message
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)