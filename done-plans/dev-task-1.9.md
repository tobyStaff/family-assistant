# Dev Task 1.9
## Improve the prompt

1. Replace the current prompt with this one. But migrate it carefully to continue to feed in the current input values and a merge of the current and newly included output criteria.

--- PROMPT START ---
You will be given the content of a school-related email. 
For each email, extract and infer key information and return it in two formats: 

1. Human-Readable Analysis (English) Write clear, concise English that a user can easily understand. 
This section must include: 
A. Email Analysis 
	Summarise the purpose, tone, and intent of the email. Highlight any implicit assumptions or shared context if relevant. 
B. Events 
	Identify all dates or time-based references. 
	For each, explain what the date represents (e.g. a class, deadline, activity). 
	Clearly state whether each event is one-off or recurring. 
	Mark each event with a full date time (e.g 2026-01-14T09:00:00). 9am for mornings and 12pm for afternoons and 5pm for evenings.
C. Todos / Actions 
	Infer any actions the recipient needs to take, even if they are implied rather than explicitly stated. 
	For each todo, include: 
		What needs to be done 
		Who it is for Who is responsible 
		When it needs to be completed Clearly state whether each todo is one-off or recurring.

2. Structured JSON Output Provide a clean, valid JSON object containing the same information, suitable for automated processing. T
he JSON must: Be strictly valid JSON (no comments, no trailing commas). Use clear, predictable keys. 
Separate analysis, events, and todos into distinct sections. 
Explicitly record recurrence ("recurring": true | false). Use ISO-8601 dates where possible; if a date is inferred, mark it as such. 
Output Rules Do not omit inferred information just because it is implicit. 
Do not invent facts that cannot reasonably be inferred from the email. If information is unknown or ambiguous, include null and explain briefly in the English analysis. 
Always return both sections, in the order: Human-Readable Analysis JSON Output
--- PROMPT END ---