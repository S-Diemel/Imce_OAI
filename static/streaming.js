// ===================== GLOBAL VARIABLES =====================

// DOM elements used for displaying the UI and capturing user input
const streamingEmbed = document.getElementById('heygen-streaming-embed');
const mediaElement = document.getElementById("mediaElement");
const fallbackImage = document.getElementById("fallbackImage");
const startSessionBtn = document.getElementById("startSessionBtn");
const taskInput = document.getElementById("taskInput");
const chatHistory = document.getElementById("chatHistory");
const micBtn = document.getElementById("micBtn"); // Make sure this exists in your HTML

// Runtime state variables used during an active session
let sessionInfo = null;
let room = null;
let mediaStream = null;
let webSocket = null;
let sessionToken = null;
let partialMessage = "";
let previous_response = undefined
let context = [];
let heygenIsSpeaking = false;
// For speech recognition
let recognition;

// Configuration constants for the avatar and API
const AVATAR_ID = "3b8a02792ccb4d52b7758f97bd133f05";
const API_CONFIG = {
  serverUrl: "https://api.heygen.com",
};

// ===================== UI HELPERS =====================

/**
 * Appends a new message to the chat history UI with a timestamp.
 *
 * @param {string} message - The message string to display in the chat log.
 */
 function markdownToHTML(text) {
   // Convert **bold** to <strong>
   text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
   // Replace newlines with <br>
   text = text.replace(/\n/g, '<br>');
   // Ensure it ends with a <br>
     if (!text.endsWith('<br>')) {
       text += '<br>';
     }
   return text;
 }

function updateChatHistory(message, user) {
  if (user){
     chatHistory.innerHTML += `<div class="chat-message">${markdownToHTML(message)}</div>`;
     chatHistory.scrollTop = chatHistory.scrollHeight;
  } else {
  chatHistory.innerHTML += markdownToHTML(message);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  }
}

/**
 * Shows or hides the fallback image and media element based on session state.
 */
function updateFallbackImage() {
  const isActive = Boolean(sessionInfo);
  fallbackImage.style.display = isActive ? 'none' : 'block';
  mediaElement.style.display = isActive ? 'block' : 'none';
}

/**
 * Displays the "Start" button only if the container is expanded and no session is active.
 */
function updateStartButton() {
  const shouldShow = streamingEmbed.classList.contains('expand') && !sessionInfo;

  if (shouldShow) {
    // Show it…
    startSessionBtn.style.display = 'block';
    startSessionBtn.disabled    = false;
    startSessionBtn.textContent = 'Start';

  } else {
    // Hide it
    startSessionBtn.style.display = 'none';
    startSessionBtn.disabled    = true;
    startSessionBtn.textContent = '';
  }
}


// ===================== INACTIVITY TIMER =====================

// Starts or resets a 10-second timer that will auto-close the session if no input is received
let inactivityTimer = null;
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    console.log("No new text prompts for 10 seconds. Stopping streaming session.");
    closeSession();
  }, 10000);
}

// ===================== TOKEN AND SESSION =====================

/**
 * Retrieves a session token from your backend.
 * This token is required for all authenticated Heygen API calls.
 */
async function getSessionToken() {
  try {
    const response = await fetch("/api/heygen/get-token", { method: "POST" });
    if (!response.ok) throw new Error("Token request failed");
    const data = await response.json();
    if (!data?.data?.token) throw new Error("No token returned from backend");
    sessionToken = data.data.token;
    console.log("Session token obtained");
  } catch (err) {
    console.error("Error obtaining session token", err);
  }
}

/**
 * Creates a new Heygen streaming session and prepares the LiveKit room.
 *
 * This sets up avatar streaming, media handling, WebSocket communication, and message events.
 */
async function createNewSession() {
  if (!sessionToken) await getSessionToken();

  try {
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.new`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        quality: "high",
        avatar_id: AVATAR_ID,
        language: "nl",
        version: "v2",
        video_encoding: "H264",
      }),
    });

    if (!response.ok) throw new Error("Failed to create new session");
    const data = await response.json();
    if (!data?.data?.url || !data?.data?.access_token || !data?.data?.session_id) throw new Error("Session info missing");

    sessionInfo = data.data;

    room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: LivekitClient.VideoPresets.h720.resolution },
    });

    // Handle incoming messages from the avatar
    room.on(LivekitClient.RoomEvent.DataReceived, (rawMessage) => {
      try {
        const textData = new TextDecoder().decode(rawMessage);
        const eventData = JSON.parse(textData);
        if (eventData.type === "avatar_stop_talking") {
          // Turn on mic
          document.querySelector("#talkBtn").disabled = false;
          micBtn.disabled = false;
          heygenIsSpeaking = false;

        }

      } catch (err) {
        console.error("Error parsing incoming data:", err);
        document.querySelector("#talkBtn").disabled = false;
        micBtn.disabled = false;
        heygenIsSpeaking = false;
      }
    });

    // Prepare an empty media stream and add tracks when available
    mediaStream = new MediaStream();

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "video" || track.kind === "audio") {
        mediaStream.addTrack(track.mediaStreamTrack);
        if (mediaStream.getVideoTracks().length && mediaStream.getAudioTracks().length) {
          mediaElement.srcObject = mediaStream;
        }
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      mediaStream.removeTrack(track.mediaStreamTrack);
    });

    room.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
      console.log(`Room disconnected: ${reason}`);
    });

    await room.prepareConnection(sessionInfo.url, sessionInfo.access_token);
    console.log("Session created successfully");
  } catch (err) {
    console.error("Error creating new session", err);
  }
}

/**
 * Starts the streaming avatar session after the session has been created.
 * Notifies Heygen to start rendering the avatar and connects to the media room.
 */
async function startStreamingSession() {
  try {
    if (!sessionInfo?.session_id) throw new Error("No session ID available.");

    await fetch(`${API_CONFIG.serverUrl}/v1/streaming.start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ session_id: sessionInfo.session_id }),
    });

    await room.connect(sessionInfo.url, sessionInfo.access_token);
    updateFallbackImage();
    console.log("Streaming started successfully");
    streamingEmbed.classList.add('session-active');
  } catch (err) {
    console.error("Error starting streaming session", err);
  }

}

/**
 * Calls the ChatGPT API with the provided text and updates the chat history with the response.
 *
 * @param {string} text - The user's input text.
 */

async function callChatGPT(text) {
  context.push({role:'user', content: text})
  const input_context = context.slice(-5);
  console.log(input_context.length)
  try {
    const response = await fetch("/api/openai/response", { method: "POST",
                                                           headers: {'Content-Type': 'application/json'},
                                                           body: JSON.stringify({ text: input_context })
                                                         }
     );

    if (!response.ok) {
      const errorText = await response.text();
      updateChatHistory(`Error: ${errorText}`, false);
      return;
    }

    const data = await response.json();

    const outputText = data.response;
    context.push({role:'assistant', content: outputText})

    return outputText;

  } catch (err) {
    updateChatHistory(`Error: ${err.message}`, false);
  }
}

function formatGPTOutput(text) {
  const stepRegex = /(\d+\.\s\*\*[^\*]+\*\*):\s*/g;

  // Add a newline between title and description
  const withNewlines = text.replace(stepRegex, "\n$1\n");

  // Optional: Add extra newlines between steps
  const formatted = withNewlines.replace(/(\n\d+\.\s\*\*[^\*]+\*\*\n)/g, "\n$1");

  return formatted.trim();
}
// ===================== COMMUNICATION =====================

/**
 * Sends a user message to the Heygen API for processing.
 * Handles input validation, updates the UI, and sends the request payload.
 *
 * @param {string} text - The user's input message to send.
 * @param {string} taskType - The type of task (e.g., "talk", "command", etc.).
 */
async function sendText(text, taskType = "repeat") {
  if (!sessionInfo) return console.error("No active session");
  if (heygenIsSpeaking) {
        return;
      }
  document.querySelector("#talkBtn").disabled = true;
  micBtn.disabled = true;

  updateChatHistory(`${text}`, true);
  const text_OAI = await callChatGPT(text);
  console.log(text_OAI);
  const sanitized = text_OAI.replace(/[😀-🛿]/gu, '').substring(0, 10000).trim();
  if (!sanitized) {
      console.warn("Attempted to send empty or invalid text. Ignoring.");
      // Re-enable the talk button if disabled due to blocking state
      document.querySelector("#talkBtn").disabled = false;
      micBtn.disabled = false;
      heygenIsSpeaking = false;
      return;
    }

    // Set the flag indicating Heygen is now busy speaking
    heygenIsSpeaking = true;

  const payload = {
    session_id: sessionInfo.session_id,
    text: sanitized,
    task_type: taskType,
  };

  try {
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Heygen API responded with status ${response.status}:`, errText);

      if (response.status === 500) {
        console.warn("Retrying once after 500 error...");
        await new Promise(res => setTimeout(res, 1000));
        document.querySelector("#talkBtn").disabled = false;
        micBtn.disabled = false;
        heygenIsSpeaking = false;
        return sendText(text, taskType);
      }
    }
  updateChatHistory(`${sanitized}`, false);

    } catch (err) {
      console.error("Error sending text", err);
      // Ensure UI is not stuck if there's an error
      document.querySelector("#talkBtn").disabled = false;
      micBtn.disabled = false;
      heygenIsSpeaking = false;
    }
  }

// ===================== SESSION CLEANUP =====================

/**
 * Gracefully shuts down the session and resets app state.
 */
async function closeSession() {
  if (!sessionInfo) return console.error("No active session");

  try {
    await fetch(`${API_CONFIG.serverUrl}/v1/streaming.stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ session_id: sessionInfo.session_id }),
    });

    if (webSocket) webSocket.close();
    if (room) room.disconnect();

    mediaElement.srcObject = null;
    sessionInfo = null;
    room = null;
    mediaStream = null;
    sessionToken = null;
    heygenIsSpeaking=false;
    document.querySelector("#talkBtn").disabled = false;
    micBtn.disabled = false;
    clearTimeout(inactivityTimer);

    updateFallbackImage();
    updateStartButton();
    console.log("Session closed");
    streamingEmbed.classList.remove('session-active');
  } catch (err) {
    console.error("Error closing session", err);
  }
}

// ===================== MICROPHONE INPUT =====================

/**
 * Initializes speech recognition using the Web Speech API.
 */
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Speech Recognition is not supported in your browser.");
    if (micBtn) {
      micBtn.disabled = true;
      micBtn.title = "Speech recognition not supported in this browser";
    }
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true; // Keeps listening until we decide to stop
  recognition.interimResults = true; // Enables interim results to monitor speech
  recognition.lang = "nl-NL"; // Dutch language to match avatar language
  recognition.maxAlternatives = 1;
  const micBtn = document.getElementById("micBtn");

  let finalTranscript = "";
  let silenceTimer;
  const silenceDelay = 2000; // 2 seconds of silence to trigger stopping

  // Reset the silence timer whenever new speech is detected
  const resetSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      recognition.stop();
    }, silenceDelay);
  };

  recognition.onstart = () => {
    finalTranscript = ""; // Reset transcript at the start
    resetSilenceTimer();
    micBtn.classList.add("recording");
  };

  recognition.onresult = (event) => {
    // Process each result from the current event
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript + " ";
      }
    }
    resetSilenceTimer();
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    updateChatHistory(`Fout bij spraakherkenning: ${event.error}`, false);
    micBtn.classList.remove("recording");
  };

  recognition.onend = () => {
    console.log("Speech recognition ended");
    micBtn.classList.remove("recording");
    // Only send the text once the recognition has fully stopped
    if (finalTranscript.trim()) {
      sendText(finalTranscript.trim(), "repeat");
    }
  }
}


// ===================== EVENT LISTENERS =====================

/**
 * Initializes all event listeners for user interaction with the UI and session handling.
 */
function initEventListeners() {
  // Handles clicks on the streaming container to expand/collapse and manage UI visibility
  streamingEmbed.addEventListener('click', (e) => {
    if (!e.target.closest('button') && !e.target.closest('input')) {
      streamingEmbed.classList.toggle('expand');
      streamingEmbed.classList.contains('expand') ? clearTimeout(inactivityTimer) : resetInactivityTimer();
      updateFallbackImage();
      updateStartButton();
    }
  });

  // Handles clicks on the start button to initiate a new streaming session
  startSessionBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!sessionInfo) {
      startSessionBtn.disabled = true;
      startSessionBtn.classList.add('loading');
      try {
        await createNewSession();
        await startStreamingSession();
      } catch (error) {
        console.error("Error starting session:", error);
      } finally {
        startSessionBtn.classList.remove('loading');
        updateStartButton();
      }
    }
  });

  // Handles the talk button click: sends text and restarts inactivity timer
  document.querySelector("#talkBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const text = taskInput.value.trim();
    if (text) {
      if (!streamingEmbed.classList.contains('expand')) resetInactivityTimer();
      sendText(text, "repeat");
      taskInput.value = "";
    }
  });

  // Allows sending text by pressing Enter in the input field
  taskInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.querySelector("#talkBtn").click();
    }
  });

  // Toggles chat history visibility on button click
//  document.querySelector("#toggleChatBtn").addEventListener("click", (e) => {
//    e.stopPropagation();
//    const isHidden = chatHistory.style.display === "none" || chatHistory.style.display === "";
//      chatHistory.style.display = isHidden ? "block" : "none";
//      e.target.textContent = isHidden ? "Verberg chat" : "Zie de chat";
//  });

  // Handles clicks on the mic button to start speech recognition
  if (micBtn) {
    micBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (recognition) recognition.start();
    });
  }
}

// ===================== INITIALIZATION =====================

// Initialize UI state and bind event listeners on page load
updateFallbackImage();
updateStartButton();
initEventListeners();
initSpeechRecognition();
