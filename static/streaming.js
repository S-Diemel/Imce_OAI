// ===================== GLOBAL VARIABLES =====================

// DOM elements used for displaying the UI and capturing user input
const streamingEmbed = document.getElementById('heygen-streaming-embed');
const mediaElement = document.getElementById("mediaElement");
const fallbackImage = document.getElementById("fallbackImage");
const startSessionBtn = document.getElementById("startSessionBtn");
const taskInput = document.getElementById("taskInput");
const chatHistory = document.getElementById("chatHistory");
const micBtn = document.getElementById("micBtn");
const minimizeBtn = document.getElementById('minimizeBtn');
const pauseBtn = document.getElementById('pauseBtn');

// Make sure this exists in your HTML

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
let recognition; // For speech recognition

// Configuration constants for the avatar and API
const AVATAR_ID = "3b8a02792ccb4d52b7758f97bd133f05";
const API_CONFIG = {
  serverUrl: "https://api.heygen.com",
};

// ===================== UI HELPERS =====================

/**
 * Initialize the Markdown renderer for non-user messages.
 * - html: allow raw HTML tags in source
 * - linkify: automatically convert URL-like text to links
 * - typographer: enable smart punctuation replacements
 */
const md = window.markdownit({
  html: true,
  linkify: true,
  typographer: true
});

/**
 * Append a new chat message to the history container.
 *
 * If `user` is truthy, escapes HTML-sensitive characters and replaces
 * newlines with `<br>` so that user input appears as plain text.
 * Otherwise, renders the message as Markdown (for system/bot messages).
 *
 * @param {string} message – The text content to append.
 * @param {boolean} user    – True if this is a user message; false for bot messages.
 */
function updateChatHistory(message, user) {
  let rendered;

  if (user) {
    // Escape HTML and preserve line breaks for user-supplied text
    rendered = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r?\n/g, '<br>');
    console.log('User message:', rendered);
    chatHistory.innerHTML += `<div class="chat-message user">${rendered}</div>`;
  } else {
    // Render system/bot messages using Markdown
    rendered = md.render(message);
    chatHistory.innerHTML += rendered;
  }

  // Scroll to the latest message
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

/**
 * Toggle visibility of the fallback image vs. media element depending on session state.
 *
 * If a session is active (`sessionInfo` truthy), hide the fallback placeholder
 * and show the media element. Otherwise, show the placeholder and hide media.
 */
function updateFallbackImage() {
  const isActive = Boolean(sessionInfo);

  // Show placeholder when no session, hide when active
  fallbackImage.style.display = isActive ? 'none' : 'block';
  mediaElement.style.display   = isActive ? 'block' : 'none';
}

/**
 * updates the pause button
 */
function updatePauseButton() {
  if (sessionInfo) {
    pauseBtn.style.display = 'flex';
  } else {
    pauseBtn.style.display = 'none';
  }
}
/**
 * Show or hide the "Start" button based on the embed container state and session.
 *
 * Only show the Start button if:
 *   1. The streaming embed container has the "expand" class.
 *   2. There is no active session.
 *
 * Otherwise, hide and disable the button.
 */
function updateStartButton() {
  const isExpanded  = streamingEmbed.classList.contains('expand');
  const hasSession  = Boolean(sessionInfo);
  const shouldShow  = isExpanded && !hasSession;

  if (shouldShow) {
    // Ready to start a new session
    startSessionBtn.style.display    = 'block';
    startSessionBtn.disabled         = false;
    startSessionBtn.textContent      = 'Start';
  } else {
    // Either collapsed or already in session—hide the button
    startSessionBtn.style.display    = 'none';
    startSessionBtn.disabled         = true;
    startSessionBtn.textContent      = '';
  }
  updatePauseButton
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
  // Ensure we have a valid session token before proceeding
  if (!sessionToken) {
    await getSessionToken();
  }

  try {
    // Request a new streaming session from the API
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.new`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        quality: "high",              // Stream quality setting
        avatar_id: AVATAR_ID,         // Identifier for the avatar to use
        language: "nl",               // Language code (Dutch)
        version: "v2",                // API version
        video_encoding: "H264",       // Video codec
      }),
    });

    // If the HTTP status is not in the 200–299 range, throw an error
    if (!response.ok) {
      throw new Error("Failed to create new session");
    }

    const data = await response.json();

    // Verify that the response contains all expected fields
    if (
      !data?.data?.url ||
      !data?.data?.access_token ||
      !data?.data?.session_id
    ) {
      throw new Error("Session info missing");
    }

    // Store the session information for later use
    sessionInfo = data.data;

    // Initialize a LiveKit Room with adaptive streaming and dynacast enabled
    room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: LivekitClient.VideoPresets.h720.resolution,
      },
    });

    // Listen for data sent from the avatar, such as stop-talking events
    room.on(LivekitClient.RoomEvent.DataReceived, (rawMessage) => {
      try {
        const textData = new TextDecoder().decode(rawMessage);
        const eventData = JSON.parse(textData);

        if (eventData.type === "avatar_stop_talking") {
          // Re-enable the talk button and microphone button once avatar stops speaking
          document.querySelector("#talkBtn").disabled = false;
          micBtn.disabled = false;
          heygenIsSpeaking = false;
        }
      } catch (err) {
        console.error("Error parsing incoming data:", err);
        // In case of parse errors, also ensure controls are re-enabled
        document.querySelector("#talkBtn").disabled = false;
        micBtn.disabled = false;
        heygenIsSpeaking = false;
      }
    });

    // Create an empty MediaStream; tracks will be added when subscribed
    mediaStream = new MediaStream();

    // When a new track is subscribed (audio/video), add it to the media stream
    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "video" || track.kind === "audio") {
        mediaStream.addTrack(track.mediaStreamTrack);

        // Once both video and audio tracks are present, attach the stream to the media element
        if (
          mediaStream.getVideoTracks().length &&
          mediaStream.getAudioTracks().length
        ) {
          mediaElement.srcObject = mediaStream;
        }
      }
    });

    // Remove tracks from the media stream when unsubscribed
    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      mediaStream.removeTrack(track.mediaStreamTrack);
    });

    // Log disconnection reasons for debugging
    room.on(LivekitClient.RoomEvent.Disconnected, async (reason) => {
      console.log(`Room disconnected: ${reason}`);
      // ensure our UI resets just like when the user clicks “Pause” or “×”
      // Restore UI state on error
        document.querySelector("#talkBtn").disabled = false;
        micBtn.disabled = false;
        heygenIsSpeaking = false;
        await closeSession();

        updateFallbackImage();
        updateStartButton();
    });


    // Finalize connection to the LiveKit server using provided session details
    await room.prepareConnection(
      sessionInfo.url,
      sessionInfo.access_token
    );

    console.log("Session created successfully");
  } catch (err) {
    // Catch and log any errors during session creation
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
    streamingEmbed.classList.add('session-active');
    updatePauseButton();
    console.log("Streaming started successfully");
    streamingEmbed.classList.add('session-active');
  } catch (err) {
    console.error("Error starting streaming session", err);
  }

}



// ===================== COMMUNICATION =====================
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


/**
 * Send a text message to the Heygen API and update the chat UI accordingly.
 *
 * This function handles:
 *   1. Session validation
 *   2. UI state management (disabling/enabling buttons)
 *   3. Sending user input to ChatGPT for preprocessing
 *   4. Sanitizing the ChatGPT response (removing emojis, trimming length)
 *   5. Sending the sanitized text payload to Heygen's streaming task endpoint
 *   6. Error handling and retry logic for 500-level errors.
 */
async function sendText(text, taskType = "repeat") {
  // Ensure there is an active session before proceeding
  if (!sessionInfo) {
    console.error("No active session");
    return;
  }

  // Prevent overlapping speech tasks
  if (heygenIsSpeaking) {
    return;
  }

  // Disable UI controls while processing
  document.querySelector("#talkBtn").disabled = true;
  micBtn.disabled = true;

  // Display the raw user input in the chat history
  updateChatHistory(text, true);

  // Preprocess the text through ChatGPT
  const text_OAI = await callChatGPT(text);
  console.log(text_OAI);

  // Remove emojis and limit to 10,000 characters
  const sanitized = text_OAI
    .replace(/[😀-🛿]/gu, '')   // Strip out emoji characters
    .substring(0, 10000)       // Enforce maximum length
    .trim();

  // If the result is empty or invalid, re-enable UI and abort
  if (!sanitized) {
    console.warn("Attempted to send empty or invalid text. Ignoring.");
    document.querySelector("#talkBtn").disabled = false;
    micBtn.disabled = false;
    heygenIsSpeaking = false;
    return;
  }

  // Mark that Heygen is now speaking to block further input
  heygenIsSpeaking = true;

  // Construct the payload for the Heygen API
  const payload = {
    session_id: sessionInfo.session_id,
    text: sanitized,
    task_type: taskType,
  };

  try {
    // Send a streaming task request to Heygen
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(payload),
    });

    // Handle non-OK responses
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Heygen API responded with status ${response.status}:`, errText);

      // Restore UI state on error
      document.querySelector("#talkBtn").disabled = false;
      micBtn.disabled = false;
      heygenIsSpeaking = false;
      await closeSession();

      updateFallbackImage();
      updateStartButton();
    }

    // Append the sanitized text to the chat history as Heygen's response
    updateChatHistory(sanitized, false);

  } catch (err) {
    // Network or unexpected error handling
    console.error("Error sending text", err);

    // Ensure UI controls are re-enabled
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
    streamingEmbed.classList.remove('session-active');
    updatePauseButton();
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
      if (!streamingEmbed.classList.contains('expand')) {
        streamingEmbed.classList.add('expand');
        updateFallbackImage();
        updateStartButton();
      }
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
  // Minimize the avatar when the ‘×’ is clicked
  minimizeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    streamingEmbed.classList.remove('expand');

    // immediately stop the streaming session
    await closeSession();
    updateFallbackImage();
    updateStartButton();
  });

  pauseBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    // This will stop the stream & clean up but leave the embed expanded
    await closeSession();
    updateFallbackImage();
    updateStartButton();
  });

  document.querySelector("#talkBtn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const text = taskInput.value.trim();
    if (!text) return;

    // Clear the input immediately
    taskInput.value = "";

    if (!sessionInfo) {
      // No HeyGen session → just send to ChatGPT
      updateChatHistory(text, true);
      try {
        const gptReply = await callChatGPT(text);
        if (gptReply) updateChatHistory(gptReply, false);
      } catch (err) {
        console.error("ChatGPT error:", err);
      }
    } else {
      // HeyGen session is live → send to avatar as before
      sendText(text, "repeat");
    }
  });

  taskInput.addEventListener('input', () => {
    taskInput.style.height = taskInput.style.height = 'auto';
    taskInput.style.height = taskInput.scrollHeight + 'px';
    console.log(taskInput.scrollHeight)
  });

  taskInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        talkBtn.click();
      }
    });

  talkBtn.addEventListener('click', () => {
    taskInput.value = '';
    taskInput.style.height = 'auto';
  });

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
