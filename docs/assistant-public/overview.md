# Platform Overview

EasyGenerator is an account platform with authentication, role-based administration, audit summaries, health checks, and an optional documentation assistant. The application exposes versioned JSON APIs and a browser interface.

## Documentation Assistant

The assistant answers questions only from the six public documents in this collection. It selects up to four relevant sections using deterministic lexical retrieval and refuses questions that are not sufficiently supported by those sections. Source cards are selected by the server and are independent of the generated prose.

The assistant is optional. When it is disabled, its chat endpoint is unavailable.

## Assistant Privacy

The application does not retain assistant messages, conversation history, selected excerpts, generated answers, or provider responses in its databases, cache, audit metadata, or logs. Request text is handled in memory while a response is produced.

When the assistant is enabled and enough public documentation is found, Gemini receives the message entered by the user, the bounded prior conversation entered in the browser, and the selected public documentation excerpts. Users should not submit personal, confidential, or sensitive information.

## Public Information Boundary

This documentation describes public application behavior. It does not contain credentials, environment values, real user identities, private infrastructure details, raw audit records, or user data.
