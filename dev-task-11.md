# 2 Auto mark passed todos and events as DONE.

1. Whenever the email analysis is run and new todos and events are analyzed, but before they are synced with the Calendar API - todos and events that are in the past (i.e yesterday and before) should be automatically be removed / marked as Done/Complete.
    - So when the daily cron job runs or email analysis is clicked from the dashboard, this cleanup step should be run.