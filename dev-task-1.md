# Dev Task 1
## Name: Email Management

1. Once per day, get all non-PROCESSED (emails that have not been marked with a PROCESSED label in gmail) emails and store the content in the db.
    - If an email has an attachment, extract the content and add to the email body (marking it as the attachment).
    - The email is stored as processed=false & analyzed=false.
    - Once the email has been stored successfully. processed=true.
    - Once the email has been analyzed and turned into events and todos, then analyzed=true.
    - If any failure to read an email or attachment happens, set the email data to processed=false in the db.
2. Once all emails have been marked as processed=true in the db, set/labels those emails (only those) as PROCESSED in the actual gmail inbox.
3. We now have the relevant email content in our db and its status AND the processed status is synced back to gmail.
4. Ensure that I can view all email content via the Dashboard page, but now it will come from our db, not from the gmail API directly.