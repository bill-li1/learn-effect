const sendButton = document.getElementById("send-request-button");
const responseDisplay = document.getElementById("response-display");
const clientIdInput = document.getElementById("client-id"); // Get the input field

sendButton.addEventListener("click", async () => {
  const clientId = clientIdInput.value.trim(); // Get the client ID from the input
  if (!clientId) {
    responseDisplay.textContent = "Error: Please enter a Client ID.";
    return;
  }

  responseDisplay.textContent = "Sending request...";
  try {
    // Fetch from the absolute URL of the backend server's root
    const response = await fetch("http://localhost:3000/", {
      method: "GET", // Explicitly set method (optional for GET, but good practice)
      headers: {
        // Add the Authorization header
        Authorization: `Bearer ${clientId}`,
      },
    });

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
