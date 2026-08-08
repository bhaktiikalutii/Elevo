import { useState } from "react";
import { useInterviewContext } from "../context/InterviewContext";
import "./interview.css";

function Interview() {
  const { candidate } = useInterviewContext();

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: "ai",
      text: `Hey ${
        candidate?.name || "there"
      }! Welcome to your ELEVO interview. I'm going to have a conversation with you rather than simply throwing questions at you.`,
    },
    {
      id: 2,
      sender: "ai",
      text: "Let's start easy. Tell me a little about yourself and what you're currently working towards.",
    },
  ]);

  const [input, setInput] = useState("");

  // Temporary AI response
  function getAIResponse(userMessage) {
    const message = userMessage.toLowerCase();

    if (
      message.includes("ai") ||
      message.includes("artificial intelligence")
    ) {
      return "That's interesting. What specifically attracted you to AI, and have you worked on any AI-related projects?";
    }

    if (message.includes("project")) {
      return "I'd love to hear more about that. What was your role in the project, and what was the biggest challenge you faced?";
    }

    if (
      message.includes("student") ||
      message.includes("college") ||
      message.includes("university")
    ) {
      return "That's a great starting point. Which area of technology are you most interested in exploring further?";
    }

    if (
      message.includes("developer") ||
      message.includes("development") ||
      message.includes("coding")
    ) {
      return "That's good to know. Which technology or programming language do you enjoy working with the most, and why?";
    }

    return "That's interesting. Can you tell me a little more about that and your experience with it?";
  }

  function handleSend(event) {
    event.preventDefault();

    if (!input.trim()) return;

    const userMessage = input.trim();

    // Add user's message
    const newUserMessage = {
      id: Date.now(),
      sender: "user",
      text: userMessage,
    };

    setMessages((previousMessages) => [
      ...previousMessages,
      newUserMessage,
    ]);

    setInput("");

    // Temporary ELEVO response
    setTimeout(() => {
      const newAIMessage = {
        id: Date.now() + 1,
        sender: "ai",
        text: getAIResponse(userMessage),
      };

      setMessages((previousMessages) => [
        ...previousMessages,
        newAIMessage,
      ]);
    }, 1000);
  }

  return (
    <div className="interview-page">

      <header className="interview-header">
        <div className="interview-logo">
          ELEVO
        </div>

        <div className="interview-status">
          <span className="status-dot"></span>
          Interview in progress
        </div>

        <div className="question-count">
          01 / 10
        </div>
      </header>

      <main className="interview-container">

        <div className="interview-intro">
          <p>INTERACTIVE INTERVIEW</p>
          <h1>Let's talk.</h1>
        </div>

        <div className="chat-container">

          {messages.map((message) => (
            <div
              key={message.id}
              className={`message-row ${message.sender}`}
            >
              <div className="message-label">
                {message.sender === "ai"
                  ? "ELEVO"
                  : "YOU"}
              </div>

              <div className="message-bubble">
                {message.text}
              </div>
            </div>
          ))}

        </div>

        <form
          className="message-form"
          onSubmit={handleSend}
        >

          <input
            type="text"
            placeholder="Type your response..."
            value={input}
            onChange={(event) =>
              setInput(event.target.value)
            }
          />

          <button type="submit">
            →
          </button>

        </form>

        <p className="interview-hint">
          Take your time. ELEVO is listening.
        </p>

      </main>

    </div>
  );
}

export default Interview;