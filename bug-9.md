# Bug 9

Title
Email with long attachment doesn't appear to be read very well with AI.

Description
I have an email with extracted attachment shown below. It seems like AI doesn't properly extract all the key info from it. 
Instead it seems to just pick 2 or 3 things and make todos or events from those. However you can see in the email, that there
are a whole host of calendar dates and things to do. We need to firstly diagnose why this happens.

Email with attachment:
(No body content)

=== IMPORTANT: ATTACHMENT CONTENT BELOW ===
This email contains document attachments. Extract all relevant information:
- Key dates and deadlines → add to calendar_updates
- Payment requests → add to financials with amounts and deadlines
- Action items → mention in summary
- If forms require signature/action → add to attachments_requiring_review

--- START: Friday Update 23 January.pdf ---
--- Page 1 ---
Friday Update  
23rd January 2026  
Attendance 94.9%

Dear Milford Families

We’ve had a fun-filled, if rather wet, week at school. We’re all really looking forward to the hot chocolate and cookie sale Year 1 are organising next Friday after school.

Much love, the Milford Team

Please don't park in the staff car park or the drive

We would love for you to be able to park onsite but unfortunately there just isn’t space and it’s not safe. There was an accident this week because parents were trying to park and manouvere their cars and a car was scratched.

There are two car parks around the school for you to use:

1.Station Lane Car Park - just a short walk from by the doctor’s surgery to the school front gate. We have car parking passes which means you can park for free, Monday to Friday between 8.25-8.55am and 2.50-3.20pm. Pop into the office if you would like one.
  
2.Village Hall car park on Portsmouth Road - it’s free and just a quick walk down the alley to the school back gate.

The ONLY exception to this is for the few families who have express permission from the school to park (and have been given parking permits).

Everyone to grow, learn, believe, achieve

--- Page 2 ---
Do you have any manure or compost spare?

That’s right! We’re in need of manure and any well-rotted compost for our allotment, so please let us know if you have any we can use. We need at least six sacks as each class has their own bed. So whatever you can do to help is much appreciated!

Please let the School Office know if you can help, pop in our email us at info@milford.surrey.sch.uk

GODALMING LEARNING PARTNERSHIP’s GET Teaching programme

Why not GET Teaching with the Godalming Learning Partnership and Winchester University?

The Godalming Learning Partnership (GLP) is a dynamic and collaborative network of schools based in and around Godalming, Surrey. The core group comprises community and church settings: Godalming, Busbridge and The Chandler Junior schools, Moss Lane, Milford and Witley Infant schools plus the outstanding Wharf Nursery. GLP is united by a shared commitment to driving up educational standards, inclusion, and curriculum enrichment. At the heart of GLP’s ethos is a belief in the power of collaboration to improve the life chances of children in the area by driving school improvement.

A flagship initiative of the partnership is its GET Teaching programme: GLP’s school-led teacher training route, delivered in partnership with the University of Winchester’s outstanding education department. We are inviting applications to start in Sept 2026.

The one year school-led GET Teaching PGCE programme provides the perfect combination of immersive classroom experience in our schools and academic study at Winchester University. It has a 100% pass rate and a strong track record of graduates progressing into leadership roles within GLP schools.

If you have questions, take a look at our website (below) or email Rachel on: coordinator@godalminglearning.org

APPLY NOW TO START NEXT SEPTEMBER

Find out more about the course and how to apply at: www.getteaching.org and Primary (3F9B) with Godalming Learning Partnership - Find postgraduate teacher training - GOV.UK

--- Page 3 ---
SHAPE THE FUTURE — BECOME A TEACHER!

Training to teach isn't just about standing at the front of a classroom; it's about inspiring minds, fostering creativity, and making a difference in ways that last a lifetime.

Imagine sharing your knowledge & passions to guide the next generation and build connections that truly matter. Teaching is dynamic, rewarding, and gives you the chance to continuously grow and learn while empowering others to do the same.

You’ll never have a dull moment — education is full of challenges that keep things exciting. So, if you're looking for a career that's meaningful, multifaceted and lets you leave your mark on the world, teaching could be your path.

Make a choice that changes lives.

Godalming Learning Partnership runs a PGCE with local schools and Winchester University’s Outstanding ITT course

www.getteaching.org

--- Page 4 ---
Term diary dates 2026

January
30 Lime Woodland School and
Hot Chocolate & Cookie Sale run by Yr 1 (after school)

February
2 I love Milford School because... Heart Love Letters coming home in book bags (return by 6 February)
6 Elm Woodland School
9 Kids Valentine Bake Off Competition and cake sale after school (in School Hall)
13 Inset Day 4
16-20 Half-term
24 Parents Evening 3.30–7pm
26 Parents Evening 3.30—5pm
26 Swimming starts for Year 2
27 Year R to Woodland School

March
5 World Book Day — Dress Up and
Wonka Bar Chocolate Sale (after school)
6 Y1 Woodland School
10 ‘Midnight in the Toyshop’ Drama4ALL Workshop (at school)
13 Lime Woodland School
16 Easter Egg Art Competition coming home in book bags (return by 23 March)
20 Elm Woodland School
23 Rocksteady Concert (for parents of children going to Rocksteady Club)
27 Last day of Spring Term and
£2-3 donation - Easter themed non-uniform day and Easter Egg Hunt

April
13 First Day of term
17 Year R to Woodland School
20 Year 2 to Woking Mosque
23 Swimming recommences for Year 2
24 Cherry Woodland School

May
1 Beech Woodland School
8 Lime woodland School
15 Elm Woodland School
18 Year 2 to Marwell Zoo
18 Science Week
22 Inset Day 5
25-29 Half-term

Events in green are organised by Milford PTA
--- END: Friday Update 23 January.pdf ---


=== END ATTACHMENT CONTENT ===

Child profile
Year: R / Reception
School: Milford

AI Response

{
  "human_analysis": {
    "email_summary": "The email contains a Friday update from Milford School, including a reminder about parking restrictions, a request for manure or compost for the school allotment, and an invitation to apply for a teacher training program. It also includes a term diary with upcoming school events and deadlines.",
    "email_tone": "informative",
    "email_intent": "information only",
    "implicit_context": "The email assumes familiarity with the school's parking situation and the term calendar."
  },
  "events": [
    {
      "title": "Hot Chocolate & Cookie Sale",
      "date": "2026-01-30T12:00:00Z",
      "end_date": "",
      "description": "Organized by Year 1 after school.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "afternoon",
      "inferred_date": false
    },
    {
      "title": "I love Milford School because… Heart Love Letters",
      "date": "2026-02-02T09:00:00Z",
      "end_date": "",
      "description": "Heart Love Letters coming home in book bags.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "morning",
      "inferred_date": false
    },
    {
      "title": "Kids Valentine Bake Off Competition and Cake Sale",
      "date": "2026-02-09T12:00:00Z",
      "end_date": "",
      "description": "Competition and cake sale after school in the School Hall.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "afternoon",
      "inferred_date": false
    },
    {
      "title": "Inset Day 4",
      "date": "2026-02-13T09:00:00Z",
      "end_date": "",
      "description": "No school for students.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    },
    {
      "title": "Half-term",
      "date": "2026-02-16T09:00:00Z",
      "end_date": "2026-02-20T15:00:00Z",
      "description": "School closed for half-term break.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    },
    {
      "title": "Parents Evening",
      "date": "2026-02-24T12:00:00Z",
      "end_date": "2026-02-24T19:00:00Z",
      "description": "Parents Evening at Milford School.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "afternoon",
      "inferred_date": false
    },
    {
      "title": "Parents Evening",
      "date": "2026-02-26T12:00:00Z",
      "end_date": "2026-02-26T17:00:00Z",
      "description": "Parents Evening at Milford School.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "afternoon",
      "inferred_date": false
    },
    {
      "title": "Swimming starts for Year 2",
      "date": "2026-02-26T09:00:00Z",
      "end_date": "",
      "description": "Swimming lessons commence for Year 2 students.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": true,
      "recurrence_pattern": "weekly",
      "time_of_day": "morning",
      "inferred_date": false
    },
    {
      "title": "Year R to Woodland School",
      "date": "2026-02-27T09:00:00Z",
      "end_date": "",
      "description": "Year R students visit Woodland School.",
      "location": "Milford School",
      "child_name": "Summer",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "morning",
      "inferred_date": false
    },
    {
      "title": "World Book Day and Wonka Bar Chocolate Sale",
      "date": "2026-03-05T09:00:00Z",
      "end_date": "",
      "description": "Dress Up and Chocolate Sale after school.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    },
    {
      "title": "‘Midnight in the Toyshop' Drama4ALL Workshop",
      "date": "2026-03-10T09:00:00Z",
      "end_date": "",
      "description": "Drama workshop at school.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "morning",
      "inferred_date": false
    },
    {
      "title": "Easter Egg Art Competition",
      "date": "2026-03-16T09:00:00Z",
      "end_date": "",
      "description": "Art competition entries coming home in book bags.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "morning",
      "inferred_date": false
    },
    {
      "title": "Rocksteady Concert",
      "date": "2026-03-23T09:00:00Z",
      "end_date": "",
      "description": "Concert for parents of children in Rocksteady Club.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "morning",
      "inferred_date": false
    },
    {
      "title": "Last day of Spring Term and Easter themed non-uniform day",
      "date": "2026-03-27T09:00:00Z",
      "end_date": "",
      "description": "Non-uniform day with Easter Egg Hunt, £2-3 donation requested.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    },
    {
      "title": "First Day of term",
      "date": "2026-04-13T09:00:00Z",
      "end_date": "",
      "description": "Start of the new term.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    },
    {
      "title": "Year R to Woodland School",
      "date": "2026-04-17T09:00:00Z",
      "end_date": "",
      "description": "Year R students visit Woodland School.",
      "location": "Milford School",
      "child_name": "Summer",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "morning",
      "inferred_date": false
    },
    {
      "title": "Science Week",
      "date": "2026-05-18T09:00:00Z",
      "end_date": "2026-05-22T15:00:00Z",
      "description": "Science Week activities at school.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    },
    {
      "title": "Inset Day 5",
      "date": "2026-05-22T09:00:00Z",
      "end_date": "",
      "description": "No school for students.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    },
    {
      "title": "Half-term",
      "date": "2026-05-25T09:00:00Z",
      "end_date": "2026-05-29T15:00:00Z",
      "description": "School closed for half-term break.",
      "location": "Milford School",
      "child_name": "General",
      "source_email_id": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    }
  ],
  "todos": [
    {
      "description": "Return Heart Love Letters by 6 February",
      "type": "FILL",
      "due_date": "2026-02-06T23:59:00Z",
      "child_name": "General",
      "source_email_id": "",
      "url": "",
      "amount": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "responsible_party": "parent",
      "inferred": false
    },
    {
      "description": "Provide manure or compost for school allotment",
      "type": "REMIND",
      "due_date": "",
      "child_name": "General",
      "source_email_id": "",
      "url": "",
      "amount": "",
      "confidence": 0.8,
      "recurring": false,
      "recurrence_pattern": "",
      "responsible_party": "parent",
      "inferred": false
    },
    {
      "description": "Read about GET Teaching programme",
      "type": "READ",
      "due_date": "",
      "child_name": "General",
      "source_email_id": "",
      "url": "www.getteaching.org",
      "amount": "",
      "confidence": 1,
      "recurring": false,
      "recurrence_pattern": "",
      "responsible_party": "parent",
      "inferred": false
    }
  ],
  "emails_analyzed": 1,
  "extraction_timestamp": "2026-01-28T17:28:37.321Z"
}
