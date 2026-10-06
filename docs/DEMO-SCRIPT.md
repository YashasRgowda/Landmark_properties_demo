# Demo for Ravi sir — step by step

**The one idea to land:** *"Every 99acres buyer gets a WhatsApp from Landmark within seconds — day or night — and your team only spends time on the buyers who are ready."*

Total time: about 20 minutes. Show, don't explain. Let him press the buttons.

---

## A. The day before

1. **Change the first WhatsApp** (most important).
   - Right now a new buyer's first message is Meta's sample "Hello World" text. That is not good enough for this meeting.
   - In Meta → WhatsApp Manager → **Message templates** → **Create template**:
     - Name: `landmark_welcome`
     - Category: **Utility**
     - Language: **English**
     - Body:
       > Hi {{1}}, thank you for your enquiry about Ashraya plots by Landmark Properties. I'm Meera, your property assistant. Reply here for prices, plot sizes, location or to book a free site visit.
     - Sample value for {{1}}: `Suresh`
   - Approval usually takes minutes to a few hours. When it says **Active**, tell Claude, and it will switch the system over.
2. **Phones.** The test WhatsApp number only messages numbers you have added in Meta (up to 5).
   - Simplest: use **your own phone** as the "buyer" phone and hand it to Ravi sir.
   - Best (if possible): add **Ravi sir's number** beforehand, so the WhatsApp lands on *his* phone. Adding it needs a code sent to his phone.
3. **Fill the screens.** On the morning of the demo, run `npm run seed`. This adds 20 realistic sample buyers, so Today, Calls and Visits look like a working office. These numbers are never messaged.
4. **Check it works.** Do one full test run on the live site: enquiry → WhatsApp → a few replies → visit booked. Then open **System health**: it should be green.
5. **Record that test run** on your screen. If the internet fails in the meeting, play the recording.

## B. Just before the meeting

- Laptop charged, on your own phone hotspot (not the office Wi-Fi).
- Phone charged, WhatsApp sound **on**, phone **not** on silent.
- Sign in first. Open these tabs: **99acres enquiry**, **Today**, **Calls to make**.
- Browser zoom 110% so everyone can read it.
- Keep the "questions to ask Meera" card (section D) printed or on your phone.

---

## C. The demo itself

### 1. Start with his problem — 2 min (no screen yet)
Ask, then listen:
- "Sir, when a 99acres lead comes in at 10 PM, when does someone first contact them?"
- "Roughly how many leads a month? How many get a call within 5 minutes?"
- "A buyer usually enquires with 3–4 builders at once. Who do you think gets the site visit?"

Let him say it himself: *the first one to respond.*
> A widely quoted Harvard Business Review study (2011) found that companies replying within an hour were about **7 times** more likely to have a real conversation with the lead than those who waited longer.

### 2. The wow moment — 3 min
- Open **99acres enquiry**. Say: *"This is the 99acres form. Once 99acres is connected, every real enquiry comes in here automatically. For today, we type it in."*
- **Hand him the buyer phone.** Let him type a name and that phone's number.
- He presses **Contact builder**. The big timer starts on the right.
- The phone buzzes within seconds. **Stop talking. Let him look at it.**
- Then say: *"No one in your office did anything. This happens at 2 AM on a Sunday too."*

### 3. Let him be the buyer — 5 min
Tell him: *"Reply like a real buyer. Ask anything."* The right-hand panel ticks off each step live.
- Prices, sizes, loan approval, location, possession.
- Ask in **Kannada**: Meera answers in Kannada.
- "Send me the documents": the PDFs arrive in the chat.
- "Can I visit on Saturday at 11?": **Site visit booked** ticks on the screen, with reminders.

### 4. The brain — 2 min
Click **Open the full conversation**:
- **About this buyer**: budget, timing and purpose, picked up from the chat on its own.
- The **Hot / Warm / Cold** rating.
- **What happens next**.
- Say: *"Your agent reads this in 10 seconds and calls knowing everything."*

### 5. Your sales team — 2 min
- **Calls to make**: the hot buyer is on top, with the reason and a big Call button. After the call, the agent taps what happened, and the next step is automatic.
- **Today**: *"This is what your sales head sees every morning."*

### 6. Nobody slips through — 2 min
Point at the sample buyers:
- **Went quiet**: automatic follow-ups on WhatsApp, then a call.
- **Not on WhatsApp**: goes straight to the call list.
- **Missed the site visit**: a rebook call.
- **Visit reminders**: sent by themselves.
- Say: *"Today these buyers are forgotten in an Excel sheet. Here, every one has a next step."*

### 7. You stay in control — 1 min
- **Project details**: *"Change a price here and Meera uses the new price in her very next message."*
- Meera only says what is on this page. If she doesn't know, she hands the buyer to your sales head. She never makes up prices or offers.

### 8. The ask — 2 min
- What happens next:
  1. Connect 99acres, MagicBricks and Housing.
  2. Landmark's own WhatsApp number.
  3. Real Ashraya details.
  4. One week of training with the team.
- Suggest a **30-day pilot on Ashraya** and measure 3 things: reply time, visits booked, and buyers who were not followed up.
- Close with a question: **"Shall we start the pilot on Ashraya next week?"** Then stay quiet and let him answer.
- Walk through `docs/proposal/Landmark-Feasibility-And-Costs.pdf` only after he says yes, or if he asks about cost.

---

## D. Questions to ask Meera (print this)

- What is the price of a 30x40 plot?
- Is this project bank-loan approved? Which banks?
- Where exactly is it? How far from the main road?
- ಬೆಲೆ ಎಷ್ಟು? (Kannada: "What is the price?")
- Please send me the approval documents.
- My budget is 50 lakh, I want to buy in 2 months.
- Can I visit the site on Saturday at 11 AM?

---

## E. If something goes wrong

- **WhatsApp takes a few seconds:** keep talking about step 1's question, or switch to the **Today** tab. Don't stare at the phone.
- **Same number used twice:** the system says it is the same buyer. Turn it into a strength: *"No duplicates. One buyer, one history."* To use that number again, run `npm run lead:reset -- <number>`.
- **Nothing arrives at all:** open **System health**, then play the recording. Say *"Let me show you yesterday's run"* calmly and move on.
- **Don't say** "the AI can make mistakes." **Do say** "Meera only answers from your project details; anything else goes to your sales head."
- **Keep the chat to about 10–15 messages.** The free AI plan has a per-minute limit.
