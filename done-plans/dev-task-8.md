# Improve implied date extraction

Here's the problem illustrated:

The email:

From: toby.stafford@gmail.com
Date: 1/11/2026, 7:02:21 PM
Morning everyone, hope you are all having a good weekend.

Nothing much to report this week just a reminder that PE falls on Monday
and Tuesday 😊

---

The 2 todos that were created with my notes in brackets ():

🎒 Pack Item (correct)
Pack PE kit (correct)
⏰ Due: Invalid Date (problem)
👶 Ella (correct)
🎯 90% confidence (correct)

--

🎒 Pack Item (correct)
Pack PE kit (correct)
⏰ Due: Invalid Date (problem)
👶 Ella (correct)
🎯 90% confidence (correct)

---

It looks like the system intends to create 2 x separate recurring todos for this email - this is correct and so is some of the other info. But it fails to show the right dates. Why is this? What can we do to fix it?