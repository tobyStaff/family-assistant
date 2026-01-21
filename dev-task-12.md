# Dev Task 11: Improve the email

## Summary
Here's an output of the latest email content. There are a number of issues. I've left comments inside a <comment></comment> tag.

Tasks
- Add a new 'homework' todo type.
- change the auto-complete removal threshold to midnight on the day it was due.
- I think todos and events should be treated differently. Todos should not be set in the calendar unless explicitly stated.

```html
<div class="container">
    <div class="header">
      <h1>📬 Family Briefing</h1>
      <div class="date">Tuesday, 20 January 2026</div>
    </div>

    
    <div class="insights-section">
      <h3>💡 Insights</h3>
      <div class="insight-item">• Smooth sailing for the family today with no urgent events.</div><div class="insight-item">• Keep an eye on Amelie's busy schedule this week to avoid any surprises.</div><div class="insight-item">• Amelie has 3 urgent tasks today; make sure to remind her to complete them.</div><div class="insight-item">• Busy week ahead for Amelie: 3 events to attend.</div><div class="insight-item">• Ella has an urgent event tomorrow; ensure she's prepared.</div><div class="insight-item">• Ella has 3 urgent tasks today; help her pack and remind her of her responsibilities.</div>
    </div>
  

    
    <div class="section">
      <div class="section-header essential">
        <span class="section-icon">🔥</span>
        <span class="section-title">Essential</span>
        <span class="section-count">7 items</span>
      </div>
      <p class="section-subtitle">Happening soon or requires immediate action</p>
      <div class="items-list">
        
    
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">📝 Fill Form</span> <comment>will become homework type</comment>
        
      </div>
      <div class="todo-description">Continue retrieval work on Energy stores and transfers</div>
      <div class="todo-meta"><span>⏰ Mon 19 Jan, 23:59</span><span class="child-badge">👶 Amelie</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">📝 Fill Form</span> <comment>will become homework type</comment>
        
      </div>
      <div class="todo-description">Upload score from BBC Bitesize section on Energy stores and transfers</div>
      <div class="todo-meta"><span>⏰ Mon 19 Jan, 23:59</span><span class="child-badge">👶 Amelie</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">⏰ Reminder</span> <comment>will become homework type</comment>
        
      </div>
      <div class="todo-description">Encourage Amelie to start Sparx Reader homework</div>
      <div class="todo-meta"><span>⏰ Today, 23:59</span><span class="child-badge">👶 Amelie</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">🎒 Pack Item</span>
        
      </div>
      <div class="todo-description">Pack PE kit for Monday</div> <comment>will become auto-completed by this point</comment>
      <div class="todo-meta"><span>⏰ Mon 19 Jan, 09:00</span><span class="child-badge">👶 Ella</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">🎒 Pack Item</span>
        
      </div>
      <div class="todo-description">Pack PE kit for Tuesday</div>
      <div class="todo-meta"><span>⏰ Today, 09:00</span><span class="child-badge">👶 Ella</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">⏰ Reminder</span> <comment>Should have been removed because the email states this was only for the nearest wednesday to when the email was sent.</comment>
        
      </div>
      <div class="todo-description">Fix Ella's PE shoes</div>
      <div class="todo-meta"><span>⏰ Tomorrow, 09:00</span><span class="child-badge">👶 Ella</span></div>
      
    </div>
  
    
    <div class="event-item">
      <div class="event-header">
        <div class="event-title">Pack: Pack PE kit for Tuesday</div> <comment>we already have a todo for this, so we don't need it again</comment>
        
      </div>
      <div class="event-meta">
        <span class="event-date">📅 Today, 07:00</span>
        <span class="child-badge">👶 Ella</span>
      </div>
      
      
    </div>
  
  
      </div>
    </div>
  

    
    <div class="section">
      <div class="section-header consideration">
        <span class="section-icon">📋</span>
        <span class="section-title">For Consideration</span>
        <span class="section-count">14 items</span>
      </div>
      <p class="section-subtitle">Coming up this week - plan ahead</p>
      <div class="items-list">
        
    
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">📝 Fill Form</span> <comment>will become homework type</comment>
        
      </div>
      <div class="todo-description">Study and complete p.7 gap fill for Deutsch</div>
      <div class="todo-meta"><span>⏰ Thu 22 Jan, 09:00</span><span class="child-badge">👶 Amelie</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">📝 Fill Form</span> <comment>will become homework type</comment>
        
      </div>
      <div class="todo-description">Complete sparx maths homework</div>
      <div class="todo-meta"><span>⏰ Fri 23 Jan, 09:00</span><span class="child-badge">👶 Amelie</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">🎒 Pack Item</span> <comment>dont need to know about next weeks pe kit yet</comment>
        
      </div>
      <div class="todo-description">Pack PE kit for Monday</div>
      <div class="todo-meta"><span>⏰ Mon 26 Jan, 09:00</span><span class="child-badge">👶 Amelie</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">📖 Read Document</span>
        <span class="amount-badge">/null</span> <comment>why is this showing null</comment>
      </div>
      <div class="todo-description">Read the attached "Parent information" presentation about online safety</div>
      <div class="todo-meta"><span class="child-badge">👶 Amelie</span></div>
      
        <div class="todo-actions">
          <a href="/https://drive.google.com/file/d/1catBLSaNajcmdNI7ISJF3E2T446WJ-n4/view" class="action-button">Pay Now →</a> <comment>says pay now for a READ todo</comment>
          
        </div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">💰 Payment</span>
        <span class="amount-badge">£60.00</span>
      </div>
      <div class="todo-description">Pay £60 via Arbor for Design and Technology materials</div>
      <div class="todo-meta"><span class="child-badge">👶 Amelie</span></div>
      
        <div class="todo-actions">
          <a href="https://login.arbor.sc/" class="action-button">Pay via Arbor →</a>
          
        </div>
      
    </div>
  
    <div class="todo-item"> <comment>good</comment>
      <div class="todo-header">
        <span class="todo-type">💰 Payment</span>
        <span class="amount-badge">£80.00</span>
      </div>
      <div class="todo-description">Pay £80 via Arbor for Windmill Hill residential trip installment</div>
      <div class="todo-meta"><span>⏰ Fri 23 Jan, 23:59</span><span class="child-badge">👶 Ella</span></div>
      
        <div class="todo-actions">
          <a href="https://login.arbor.sc/" class="action-button">Pay via Arbor →</a>
          
        </div>
      
    </div>
  
    <div class="todo-item"> <comment>I haven't signed up for Tennis yet, so it shouldn't be a pack item yet.</comment>
      <div class="todo-header">
        <span class="todo-type">🎒 Pack Item</span>
        
      </div>
      <div class="todo-description">Pack water bottle, sun hat, sunscreen, waterproof jacket, warm clothing, snacks, and nut-free packed lunch for Tennis Camp</div>
      <div class="todo-meta"><span>⏰ Mon 16 Feb, 08:30</span></div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">⏰ Reminder</span>
        
      </div>
      <div class="todo-description">Submit artwork for Young Artists Comic Con-style Exhibition by end of February</div>
      <div class="todo-meta"><span>⏰ Sun 1 Mar, 23:59</span></div>
      
        <div class="todo-actions">
          <a href="https://www.youngdesignersacademy.co.uk/ccomi-con" class="action-button">Pay Now →</a>
          
        </div>
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">📖 Read Document</span>
        
      </div>
      <div class="todo-description">Read the attached Spring 1 newsletter</div>
      
      
    </div>
  
    <div class="todo-item"> <comment>good: I haven't signed up for tennis yet, so this should be the only action.</comment>
      <div class="todo-header">
        <span class="todo-type">📝 Fill Form</span>
        
      </div>
      <div class="todo-description">Complete and return Tennis Camp form via email to munozjorgemartin@yahoo.com</div>
      
      
    </div>
  
    <div class="todo-item">
      <div class="todo-header">
        <span class="todo-type">💰 Payment</span>
        
      </div>
      <div class="todo-description">Submit payment for Tennis Camp via BACS to Jorge Miguel Martin Munoz</div>
      
      
        <div class="todo-actions">
          <span class="payment-provider-badge">💳 Pay via BACS</span>
          
        </div>
      
    </div>
  
    
    <div class="event-item">
      <div class="event-header">
        <div class="event-title">Interior Design Lesson</div>
        
      </div>
      <div class="event-meta">
        <span class="event-date">📅 Sat 24 Jan, 11:00</span>
        <span class="child-badge">👶 Amelie</span>
      </div>
      
      <div class="event-description">Amelie's interior design lesson.</div>
    </div>
  
    <div class="event-item">
      <div class="event-header">
        <div class="event-title">Prep: Pack PE kit for Monday</div>
        
      </div>
      <div class="event-meta">
        <span class="event-date">📅 Sun 25 Jan, 19:00</span>
        <span class="child-badge">👶 Amelie</span>
      </div>
      
      
    </div>
  
    <div class="event-item">
      <div class="event-header">
        <div class="event-title">Pack: Pack PE kit for Monday</div>
        
      </div>
      <div class="event-meta">
        <span class="event-date">📅 Mon 26 Jan, 07:00</span>
        <span class="child-badge">👶 Amelie</span>
      </div>
      
      
    </div>
  
  
      </div>
    </div>
  

    <div class="footer">
      Generated by Inbox Manager
    </div>
  </div>
```