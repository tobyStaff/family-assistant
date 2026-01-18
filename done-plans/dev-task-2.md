# Dev Task 2
## Name: Email Analysis

1. Once per day (strictly must be after the latest Email downloading process), run the email analysis in the following way:
    - Get the email content from the email DB table. This should now include email metadata, email body and email attachement all in one block of text.
    - Get any useful context from the user profile settings or children's profiles to add to the prompt.
    - For each email run the 1st analysis - Send each email to the AI API individually with the same prompt. The prompt is focused on extracting highly correct Events & Todos.
        - Events extraction - [prompt]
        - Todos extraction - [prompt]
    - For each email run the 2nd analysis - Send each email to the AI API individually with the same prompt. This prompt is focused on reviewing and improving the output of the first response. It should also mark the output giving it a score between 1-10 where 1 is low and 10 is high.
    - For each email store the Events & Todos in their respective tables so they can also be linked back to the email they came from. Also store the analysis (events and todo json and a human readable analysis with intent and inferences) output along with its score, ensure it can be linked back to the event, todo & original email.
    - Add a page linked from the dashboard, so the raw emails can be viewed side by side with their analysis to enable reviewing of AI performance and quality.