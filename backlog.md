# Bugs
2. READ more Buttons -> Sometimes the buttons say pay now when the todo is nothing to do with payment.
3. Smarter analysis of todos and events with the example of the Volcano homework todo and the event of the date to take it to school.
4. Recurring events need attention, Ella's pe kit reminder has not been recurring in the diary. I think it only when in once.
7. when a todo contains something that needs to be packed or brought to school on a certain day or date, then an extra event should be created (single or recurring). - Done / NEEDS WORK

DONE
X. impersonate doesn't work properly in prod, shows todos and events, but not email analysis and stored emails. __FIXED__
X. multiple env files doesn't appear to work fully when deploying (still looks at .env not .env.production)
X. Attachment reading fails. __DONE__
X. Send Summary email not working & also daily briefing didn't send this morning. __DONE__
X. Something is making the email too wide so on a mobile screen it scrolls left to right slightly and isn't locked in place.
X. Buttons -> "Done" buttons don't work

-------------------------

# New Features
1. "Linked todos" and events -> i may complete the volcano homework, but also need to remember which day to bring it to school, for example.
2. "More detail" - Document links - render documents on a link for further reading. 1 click from the email.
3. Capture WhatsApp group messages.
4. Proper "onboarding".
5. Reading text from images.
6. Ability to sync data from prod to dev, to mess around with.
7. Dedicated email address - Custom email domains. (partially done requires AWS setup)
8. Calendar integrations with Gmail and outlook.
9. Retry functionality - is there a way for admin or a user to retry an email parsing.
10. Store the original attachments.

-------------------------

# Ideas
1. Detection on dates passed being irrelevant, auto remove todos and events that are in the past from todos and events but leave them in the Calendar, they can just be marked as "done" and therefore wont need to appear in the list or email anymore.
2. Detect emergency emails?
3. map the codebase so that it takes less tokens to do future tasks.

-------------------------