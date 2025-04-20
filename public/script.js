const sendButton = document.getElementById("send-request-button");
const responseDisplay = document.getElementById("response-display");
const clientIdInput = document.getElementById("client-id"); // Get the input field

// --- Admin Override Elements ---
const adminClientIdInput = document.getElementById("admin-client-id");
const adminOverrideCheckbox = document.getElementById("admin-override-status");
const adminOverrideButton = document.getElementById("admin-override-button");
const adminResponseDisplay = document.getElementById("admin-response-display");
// --- End Admin Override Elements ---

sendButton.addEventListener("click", async () => {
  const clientId = clientIdInput.value.trim(); // Get the client ID from the input
  // Remove the early return if clientId is empty, we now handle it
  // if (!clientId) {
  //   responseDisplay.textContent = "Error: Please enter a Client ID.";
  //   return;
  // }

  responseDisplay.textContent = "Sending request...";
  try {
    // Define base fetch options
    const fetchOptions = {
      method: "GET",
      headers: {},
    };

    // Conditionally add the Authorization header
    if (clientId) {
      fetchOptions.headers["Authorization"] = `Bearer ${clientId}`;
    } else {
      responseDisplay.textContent =
        "Client ID empty, sending request using IP address...";
    }

    // Fetch from the absolute URL of the backend server's root
    const response = await fetch("http://localhost:3000/", fetchOptions);

    let headersText = "";
    response.headers.forEach((value, key) => {
      headersText += `${key}: ${value}\n`;
    });

    const bodyText = await response.text(); // Read body as text

    // Check for Retry-After header specifically on 429 responses
    let retryAfterInfo = "";
    if (response.status === 429) {
      const retryAfterValue = response.headers.get("Retry-After");
      if (retryAfterValue) {
        retryAfterInfo = `\n\nSuggestion: Retry after ${retryAfterValue} seconds.`;
      }
    }

    responseDisplay.textContent = `
Status: ${response.status} ${response.statusText}

Headers:
${headersText}
Body:
${bodyText || "(No body)"}${retryAfterInfo}
        `.trim();
  } catch (error) {
    // Handle potential CORS errors or network issues
    console.error("Fetch error:", error);
    if (
      error instanceof TypeError &&
      error.message.includes("Failed to fetch")
    ) {
      responseDisplay.textContent = `Error sending request: Could not connect to the backend server at http://localhost:3000. Make sure it's running and accessible. (Potential CORS issue)`;
    } else {
      responseDisplay.textContent = `Error sending request: ${error.message}`;
    }
  }
});

// --- Admin Override Logic ---
adminOverrideButton.addEventListener("click", async () => {
  const clientId = adminClientIdInput.value.trim();
  const overrideStatus = adminOverrideCheckbox.checked;

  if (!clientId) {
    adminResponseDisplay.textContent =
      "Error: Please enter a Client ID for the admin override.";
    return;
  }

  adminResponseDisplay.textContent = "Sending admin override request...";

  try {
    const response = await fetch(
      "http://localhost:3000/admin/override-rate-limit",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Note: No Authorization header needed for this simple example,
          // but a real app would require admin authentication here.
        },
        body: JSON.stringify({
          clientId: clientId,
          override: overrideStatus,
        }),
      }
    );

    let headersText = "";
    response.headers.forEach((value, key) => {
      headersText += `${key}: ${value}\n`;
    });

    const bodyJson = await response.json(); // Expecting JSON response

    adminResponseDisplay.textContent = `
Status: ${response.status} ${response.statusText}

Headers:
${headersText}
Body:
${JSON.stringify(bodyJson, null, 2)} 
        `.trim();
  } catch (error) {
    console.error("Admin Override Fetch error:", error);
    let errorMessage = `Error sending request: ${error.message}`;
    if (
      error instanceof TypeError &&
      error.message.includes("Failed to fetch")
    ) {
      errorMessage = `Error sending request: Could not connect to the backend server at http://localhost:3000. Make sure it's running and accessible.`;
    }
    adminResponseDisplay.textContent = errorMessage;
  }
});
// --- End Admin Override Logic ---
