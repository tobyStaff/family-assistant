# Improve noise exclusion 3  

Examples of events or todos incorrectly included or assigned to a Child.

1. Understand the difference between sub-tasks of a main task and distinct tasks to treat separatley. The following example shows 3 very similar todos extracted from one source email, when 1 todo would be sufficient. The event is correct. Some emails containing general info will need distinct events and todos, but most likely an email about a single topic may contain multiple dates that should always be multiple events. However a single topic email will usually on need 1 todo item. 

AI Extraction result:
{
  "human_analysis": {
    "email_summary": "The email informs parents about the upcoming Animaltastic learning week from February 9th to 12th, 2026, and requests parental support in helping children prepare by gathering information and materials at home.",
    "email_tone": "informative",
    "email_intent": "action required",
    "implicit_context": "Assumes parents are aware of the school's focus on independent, child-led learning and the 6Rs learning framework."
  },
  "events": [
    {
      "title": "Animaltastic Learning Week",
      "date": "2026-02-09T09:00:00Z",
      "end_date": "2026-02-12T15:00:00Z",
      "description": "A week of child-led learning focused on animals, encouraging independent work and creativity.",
      "location": "Busbridge CE Junior School",
      "child_name": "General",
      "source_email_id": "Email 1",
      "confidence": 0.9,
      "recurring": false,
      "recurrence_pattern": "",
      "time_of_day": "all_day",
      "inferred_date": false
    }
  ],
  "todos": [
    {
      "description": "Help your child decide on an animal theme for Animaltastic week",
      "type": "DECIDE",
      "due_date": "2026-02-09T09:00:00Z",
      "child_name": "General",
      "source_email_id": "Email 1",
      "url": "",
      "amount": "",
      "confidence": 0.8,
      "recurring": false,
      "recurrence_pattern": "",
      "responsible_party": "parent",
      "inferred": false
    },
    {
      "description": "Assist your child in gathering information and resources for Animaltastic week",
      "type": "DECIDE",
      "due_date": "2026-02-09T09:00:00Z",
      "child_name": "General",
      "source_email_id": "Email 1",
      "url": "",
      "amount": "",
      "confidence": 0.8,
      "recurring": false,
      "recurrence_pattern": "",
      "responsible_party": "parent",
      "inferred": false
    },
    {
      "description": "Source materials for a model or 3D piece for Animaltastic week",
      "type": "DECIDE",
      "due_date": "2026-02-09T09:00:00Z",
      "child_name": "General",
      "source_email_id": "Email 1",
      "url": "",
      "amount": "",
      "confidence": 0.8,
      "recurring": false,
      "recurrence_pattern": "",
      "responsible_party": "parent",
      "inferred": false
    }
  ],
  "emails_analyzed": 1,
  "extraction_timestamp": "2026-02-08T19:41:52.870Z"
}

Source email:
(No body content)

=== IMPORTANT: ATTACHMENT CONTENT BELOW ===
This email contains document attachments. Extract all relevant information:
- Key dates and deadlines → add to calendar_updates
- Payment requests → add to financials with amounts and deadlines
- Action items → mention in summary
- If forms require signature/action → add to attachments_requiring_review

--- START: One World Week - Animaltastic.pdf ---
Headteacher  Mr Richard   Catchpole BSc (Hons) PGCE NPQH  Friday   30 th   January 2026  Dear Parents / C arers  Animaltastic   –   child - led learning   -   9 th   to 1 2 th   February 202 6  This letter contains   informat ion regarding our   Animaltastic learning week   in February . We would  appreciate your   help in supporting your child(ren) with this, as needed.  Last year we carried out a hugely successful   One World Week   which enabled our children to carry  out independent and child - led learning. As educators we saw great value in   that learning event, so  we are carrying out a similar week of learning in the week before half - term. This time we are  calling the week,   Animaltastic .  The children have discussed this in class and in assembly. They have been set homework by their  class te acher to help them collect information in readiness for the Animaltastic week. Thank you  for supporting them in helping to collect ideas and information that they can then use in school.  Animaltastic   will provide:  -   The opportunity to practice our 6Rs (Be haviours For Learning) as well as our   Transferrable  Skills (see below for a list of these).  -   An   opportunity for children to find out and share information about   animals   that   are   of interest  to them   (i f the child cannot select their own   animals   they can   use information provided   by the ir  class teacher ).  -   An   opportunity for children to engage in independent, self - l ed work. They will be given o ptions  about what work outcomes they   can produce, and they   will self - select an appropriate number  from thi s list (e.g. a quiz, a fact - file, annotated   diagram , poster, etc).  What   animal   information could be covered   by the children? Well, a nything of interes t to them :  mythical animals, pets, zoo animals, animal care, endangered animals, habitats, camouflage art   …  the list goes on.   They have discussed some options in class .  Busbridge CE (Aided) Junior School  Brighton Road  Busbridge  Godalming  Surrey  GU7 1XA  Telephone: 01483 417302  Email: admin@busbridge - junior.surrey.sch.uk  Website: www.busbridge - junior.surrey.sch.uk

What help are we request ing from parents?  (i)   Help them decide   what animals, group of animals or animal - theme they would like to  focus on.  (ii)   Help   them to find information, pictures and resources that they can bring in to school.  They will then use this information in class. This will also be part of their homework.  (iii)   If your child is going to make a model or 3D piece (for example using a shoe box) th ey  will need to source these things at home and bring them into school.  As the whole school is conducting this project at the same time we cannot guarantee access to the  internet at school, hence research at home will be very important.  Thank you for your help and support at home to hel ping us ensure that Animaltastic is   an   effective  and enjoyable   learning activity for your child(ren).  Kind regards  Richard Catchpole  6Rs (Behaviours For Learning) &   Transferrable Skills   –   a Busbridge CE Junior School initiative  At BJS we teach   specific curriculum knowledge and cur riculum   skills , as per the National Curriculum.  We also teach children how to learn through our 6Rs :   our   6 Behaviours For Learning ( showing   Respect ,  being   Ready   to learn,   and being   Responsible ,   Resilient ,   Re sourceful ,   Reflective   learners .  Along   with the above we also provide opportunities for children to develop what we refer to as  Transferrable Skills. These are broad skills that will enable them to be effective and successful across the  many areas of their life both now and in the future.

These are just some of the ways that the children can share their learning and   Animaltastic   information:  Interview   Drama   3D model  Instructions   Game   Puppet Show  Timeline   Story Map   Diagram  Poem   Quiz   Fact File  Acrostic   Photographs   Presentation  Brochure   List   Kidspiration  Painting   Poster   Song  Dance   Rap   Cartoon  Advert   / TV Show   Letter   Mind Map  and so on …. !
--- END: One World Week - Animaltastic.pdf ---


=== END ATTACHMENT CONTENT ===