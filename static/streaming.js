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

// Runtime state variables used during an active session
let sessionInfo = null;            // Stores Heygen session details once established
let room = null;                   // LiveKit Room instance for media streaming
let mediaStream = null;            // MediaStream used to attach tracks for playback
let sessionToken = null;           // Authentication token from backend to interact with Heygen API
let context = [];                  // Conversation context array for ChatGPT calls
let heygenIsSpeaking = false;      // Flag to prevent overlapping speech tasks
let recognition;                   // SpeechRecognition instance for microphone input

// Configuration constants for the avatar and API
const AVATAR_ID = "3b8a02792ccb4d52b7758f97bd133f05";
const API_CONFIG = {
  serverUrl: "https://api.heygen.com"
};

// Number of recent context messages to send to ChatGPT
const MAX_CONTEXT_MESSAGES = 5;

// number of seconds where there has to be silence for the microphone to stop listening and sends the text
const silenceDelaySeconds = 2; // 2 seconds of silence to trigger stopping
const silenceDelay = silenceDelaySeconds*1000

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
 * If `user` is true, escape HTML-sensitive characters and replace
 * newlines with `<br>` so that user input appears safely.
 * Otherwise, render the message as Markdown (for system/bot messages).
 * Scrolls the chat container to always show the latest message.
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
  mediaElement.style.display = isActive ? 'block' : 'none';
}

/**
 * Updates the display status of the pause button.
 *
 * Shows the pause button if a session is active; hides it otherwise.
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
 * Only show the Start button if:
 *   1. The streaming embed container has the "expand" class.
 *   2. There is no active session.
 *
 * Otherwise, hide and disable the button.
 */
function updateStartButton() {
  const isExpanded = streamingEmbed.classList.contains('expand');
  const hasSession = Boolean(sessionInfo);
  const shouldShow = isExpanded && !hasSession;

  if (shouldShow) {
    // Ready to start a new session
    startSessionBtn.style.display = 'block';
    startSessionBtn.disabled = false;
    startSessionBtn.textContent = 'Start';
  } else {
    // Either collapsed or already in session—hide the button
    startSessionBtn.style.display = 'none';
    startSessionBtn.disabled = true;
    startSessionBtn.textContent = '';
  }

  // Also update the pause button in case session state changed
  updatePauseButton();
}

// ===================== TOKEN AND SESSION MANAGEMENT =====================

/**
 * Retrieves a session token from your backend.
 * This token is required for all authenticated Heygen API calls.
 *
 * @returns {Promise<void>}
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
 * Steps performed:
 *   1. Ensures a valid session token is available.
 *   2. Requests a new streaming session from the Heygen API.
 *   3. Initializes a LiveKit Room with adaptive streaming and dynacast enabled.
 *   4. Binds to room events to handle incoming media tracks and data events.
 *
 * @returns {Promise<void>}
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

    /**
     * Listen for data sent from the avatar, such as stop-talking events.
     * When avatar stops talking, re-enable talk and mic buttons.
     */
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

    /**
     * When a new track is subscribed (audio/video), add it to the media stream.
     * Once both video and audio tracks are present, attach the stream to the media element.
     */
    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "video" || track.kind === "audio") {
        mediaStream.addTrack(track.mediaStreamTrack);

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

    /**
     * Log disconnection reasons for debugging.
     * On error or manual disconnect, reset UI just like when the user clicks “Pause” or “×”.
     */
    room.on(LivekitClient.RoomEvent.Disconnected, async (reason) => {
      console.log(`Room disconnected: ${reason}`);
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
    console.error("Error creating new session", err);
  }
}

/**
 * Starts the streaming avatar session after the session has been created.
 *
 * Steps:
 *   1. Validates that a session ID exists.
 *   2. Calls Heygen API to start the streaming task.
 *   3. Connects to the LiveKit room for media.
 *   4. Updates UI elements to reflect active streaming.
 *
 * @returns {Promise<void>}
 */
async function startStreamingSession() {
  try {
    if (!sessionInfo?.session_id) throw new Error("No session ID available.");

    // Tell Heygen to start rendering the avatar
    await fetch(`${API_CONFIG.serverUrl}/v1/streaming.start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ session_id: sessionInfo.session_id }),
    });

    // Connect to the LiveKit room for media playback
    await room.connect(sessionInfo.url, sessionInfo.access_token);

    // Update UI now that streaming is active
    updateFallbackImage();
    streamingEmbed.classList.add('session-active');
    updatePauseButton();
    console.log("Streaming started successfully");
    streamingEmbed.classList.add('session-active');
  } catch (err) {
    console.error("Error starting streaming session", err);
  }
}

// ===================== COMMUNICATION WITH CHATGPT AND HEYGEN =====================

/**
 * Calls the ChatGPT API with the provided text and updates the chat history with the response.
 * Maintains context (last 5 messages) when sending to ChatGPT.
 *
 * @param {string} text - The user's input text.
 * @returns {Promise<string|undefined>} - Returns the assistant’s response text if successful.
 */
async function callChatGPT(text) {
  // Push the new user message into context
  context.push({ role: 'user', content: text });
  // Only send the most recent 5 messages to the API
  const input_context = context.slice(-MAX_CONTEXT_MESSAGES);
  console.log(input_context.length);

  try {
    const response = await fetch("/api/openai/response", {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input_context })
    });

    if (!response.ok) {
      const errorText = await response.text();
      updateChatHistory(`Error: ${errorText}`, false);
      return;
    }

    const data = await response.json();
    const outputText = data.response;

    // Store the assistant’s reply in context
    context.push({ role: 'assistant', content: outputText });
    return outputText;
  } catch (err) {
    updateChatHistory(`Error: ${err.message}`, false);
  }
}

/**
 * Send a text message to the Heygen API and update the chat UI accordingly.
 * This function handles:
 *   1. Preventing overlapping speech tasks.
 *   2. UI state management (disabling/enabling buttons).
 *   3. Sending user input to ChatGPT for preprocessing.
 *   4. Sanitizing the ChatGPT response (removing emojis, trimming length).
 *   5. Sending the sanitized text payload to Heygen's streaming task endpoint.
 *   6. Error handling and retry logic for 500-level errors.
 *
 * @param {string} text       – The user's message to send.
 * @param {string} taskType   – The Heygen task type (default "repeat").
 * @returns {Promise<void>}
 */
async function sendText(text, taskType = "repeat") {
  // Prevent overlapping speech tasks
  if (heygenIsSpeaking) {
    return;
  }

  // Disable UI controls while processing
  document.querySelector("#talkBtn").disabled = true;
  micBtn.disabled = true;

  // Display the raw user input in the chat history
  updateChatHistory(text, true);

  // If there is no active Heygen session, just call ChatGPT and return
  if (!sessionInfo) {
    try {
      const gptReply = await callChatGPT(text);
      if (gptReply) updateChatHistory(gptReply, false);
    } catch (err) {
      console.error("ChatGPT error:", err);
    }
    document.querySelector("#talkBtn").disabled = false;
    micBtn.disabled = false;
    heygenIsSpeaking = false;
    return;
  }

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

  // Append the sanitized text to the chat history as Heygen’s "spoken" response
  updateChatHistory(sanitized, false);
  // Mark that Heygen is now speaking to block further input
  heygenIsSpeaking = true;

  // Construct the payload for the Heygen API
  const payload = {
    session_id: sessionInfo.session_id,
    text: sanitized,
    task_type: taskType
  };

  try {
    // Send a streaming task request to Heygen
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`
      },
      body: JSON.stringify(payload)
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
 * Gracefully shuts down the Heygen session and resets UI state.
 *
 * Steps:
 *   1. Calls Heygen API to stop the streaming task.
 *   2. Disconnects from LiveKit room if open.
 *   3. Clears media element’s source, resets state variables, and updates UI.
 *
 * @returns {Promise<void>}
 */
async function closeSession() {
  if (!sessionInfo) return console.error("No active session");

  try {
    // Tell Heygen to stop the streaming session
    await fetch(`${API_CONFIG.serverUrl}/v1/streaming.stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`
      },
      body: JSON.stringify({ session_id: sessionInfo.session_id })
    });

    // Close any open LiveKit room
    if (room) room.disconnect();

    // Clear media and session state
    mediaElement.srcObject = null;
    sessionInfo = null;
    room = null;
    mediaStream = null;
    sessionToken = null;
    heygenIsSpeaking = false;

    // Ensure talk and mic buttons are enabled
    document.querySelector("#talkBtn").disabled = false;
    micBtn.disabled = false;

    // Remove active session class and update UI toggles
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
 *
 * Sets recognition settings:
 * - Continuous listening until manually stopped.
 * - Interim results enabled to detect pauses.
 * - Language set to NL (Dutch).
 * - Single best alternative for interim/final results.
 *
 * When recognition ends or errors, handles sending full transcript.
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
  recognition.continuous = true;     // Keeps listening until we decide to stop
  recognition.interimResults = true;  // Enables interim results to monitor speech
  recognition.lang = "nl-NL";        // Dutch language to match avatar language
  recognition.maxAlternatives = 1;

  const micBtn = document.getElementById("micBtn");
  let finalTranscript = "";
  let silenceTimer;

  /**
   * Resets the silence timer whenever new speech is detected.
   * After `silenceDelay` ms of no speech, recognition.stop() is called.
   */
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
    // Process each recognition result from the event
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
    // Only send the text once recognition has fully stopped
    if (finalTranscript.trim()) {
      sendText(finalTranscript.trim(), "repeat");
    }
  };
}

// ===================== EVENT LISTENERS SETUP =====================

/**
 * Initializes all event listeners for user interaction with the UI and session handling.
 * Binds click handlers for expanding the embed, starting/stopping sessions,
 * sending text, and microphone input.
 */
function initEventListeners() {
  // Handles clicks on the streaming container to expand/collapse and manage UI visibility
  streamingEmbed.addEventListener('click', (e) => {
    // If the user clicked outside of a button or input
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

  // Minimize the avatar when the “×” is clicked
  minimizeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    streamingEmbed.classList.remove('expand');

    // Immediately stop the streaming session
    await closeSession();
    updateFallbackImage();
    updateStartButton();
  });

  // Pause (stop) the session while keeping the embed expanded
  pauseBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await closeSession();
    updateFallbackImage();
    updateStartButton();
  });

  // Handles clicks on the talk button to send text from the input field
  document.querySelector("#talkBtn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const text = taskInput.value.trim();
    if (!text) return;

    // Clear the input immediately and send text
    taskInput.value = "";
    sendText(text, "repeat");
  });

  // Auto-resize the task input textarea as the user types
  taskInput.addEventListener('input', () => {
    taskInput.style.height = 'auto';
    taskInput.style.height = taskInput.scrollHeight + 'px';
    console.log(taskInput.scrollHeight);
  });

  // Handle pressing Enter (without Shift) to send message
  taskInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.querySelector("#talkBtn").click();
    }
  });

  // Clear input and reset height when talk button is clicked (defensive)
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

// ===================== INITIALIZATION ON PAGE LOAD =====================

// Set initial UI state: show fallback image, hide media, hide start/pause controls
updateFallbackImage();
updateStartButton();
// Bind event listeners for user interactions
initEventListeners();
// Initialize speech recognition (if supported)
initSpeechRecognition();
