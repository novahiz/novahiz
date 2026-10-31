# Catalogue complet — novahiz-humanizer

Déplacé depuis SKILL.md le 2026-10-31 (NX-32, divulgation progressive).
Aucun exemple n'a été modifié.

### Hollow contrasts

The negative half names something nobody claimed, so the positive half sounds larger. Weight without a claim.

#### Not X but Y

*Act on one sighting.*

Forms: not X but Y; not just, not only, or not merely X, but Y; it is not X, it is Y; the reversed X rather than Y; the same opposition split across two sentences ("This does not mean X. It means Y."); a clipped negative tail ("..., no guessing"). The formula exists in every language; treat the local equivalent the same way. Keep a contrast only when the negative half corrects a belief the reader actually holds, or when both halves carry information.

> The dashboard is not just a set of charts; it is a narrative about quarterly health.

Rewritten:

> The dashboard charts quarterly health.

**Split across sentences:**

> This does not mean every route is equivalent. It means no system outside the team confirms which route is right.

Rewritten:

> No system outside the team confirms which route is right, although the routes still carry different operating costs.

**Clipped tail:**

> The picker fills from the active record, no guessing.

Rewritten:

> The picker fills from the active record so the user does not have to guess.

#### Arguing with nobody

*Act when several defenses appear in one passage; one alone may be a real clarification.*

The text answers an objection or rejects an option that appears nowhere else, usually left over from an earlier draft. Remove the defense; if it holds a real claim, state the claim. Keep an objection the text attributes or answers in full, and keep an option a reader would actually weigh.

Signals: This is not (mainly) about, I am not saying, To be clear, Do not get me wrong, This is not to say, Some might say... but, A tempting approach would be, One might be tempted to, You might think... but, It would be easy to just.

> This is not mainly about prompt length, and I am not arguing that docs do not matter. You could file the problem another way, but the real issue is whether the agent can follow the instruction when it acts.

Rewritten:

> The issue is whether the agent can follow the instruction when it acts.

**Invented alternative:**

> Keys rotate every 24 hours. A tempting approach would be to bounce the auth service from cron, but that would drop every live session. Rotation happens in place; clients refresh on their own.

Rewritten:

> Keys rotate every 24 hours in place; clients refresh on their own.

### Stage business before the point

The writer stages a moment instead of making the point.

#### Run-ups

*Act on one sighting.*

Announcements and staged candor: Let's dive in, let's explore, let's break this down, here is what you need to know, now let's look at, without further ado, heads up, a quick note, Honestly?, Look, Here's the thing, The thing is, Let's be honest, Real talk, plus casual orders such as "one thing that bit me, so pay attention". Remove the run-up, not just its tone. "Honestly" inside a casual sentence is ordinary; the tell is the standalone opener before a routine claim.

> Let's dive into how rate limiting works at the edge. Here is what you need to know.

Rewritten:

> The edge layer enforces rate limits per API key before a request reaches the origin.

**Staged candor:**

> Is the tier worth it? Honestly? It depends on how often you ship.

Rewritten:

> Whether the tier is worth it depends on how often you ship.

#### One-line closers and fragment stacks

*Act on one sighting for a closer that repeats; a single short paragraph may still carry a new fact.*

A one-sentence paragraph that restates the paragraph before it: That is the real win. Read that again. Let that sink in. The same closer after several sections. A row of fragments ("No roadmap. No promises."). One word in ALL CAPS or split by periods (every. single. day.). The line asks the reader to pause on a claim instead of adding to it. Cut a closer that repeats. Merge a row of fragments into a sentence with a specific claim.

> Caching kills repeat work.
>
> That is the real win.
>
> Retries hide blips.
>
> That is the real win.

Rewritten:

> Caching kills repeat work.
>
> Retries hide blips.

**Fragment stack:**

> The agent had no fixed persona. No house style. No loyalty to the old outline. The draft was free.

Rewritten:

> The agent dropped the fixed persona, the house style, and the old outline. The draft could move freely.

#### Platitudes dressed as insight

*Act on one sighting.*

An ordinary point costumed as a hidden truth: the real question is, at its core, in reality, what really matters, fundamentally, the deeper issue, the heart of the matter, X is the Y of Z, X becomes a trap, X is not a tool but a mirror, the language of, the currency of, the architecture of. The costume adds no detail. Replace the saying with the specific claim.

> The real question is whether teams can adapt. At its core, what matters is organizational readiness.

Rewritten:

> Whether teams can adapt depends on whether the organization is ready to change its habits.

**Aphorism form:**

> Symmetry is the language of trust. Efficiency becomes a trap when teams forget the human layer.

Rewritten:

> Symmetric layouts tend to feel predictable to users. Teams can over-optimize a workflow and miss how people actually use it.

### Cadence applied by template

A person may do any one of these on purpose, so the weaker ones need company from other tells.

#### Forced triads

*Weak alone; act when the three items do not carry three distinct ideas.*

Ideas arrive in threes to sound complete, whether the meaning has three parts or not: one sentence ("speed, clarity, and delight"), three parallel examples, or three short facts followed by a lesson. Check that each item adds a distinct idea. Merge examples, develop the strongest one, or vary the structure when they do not. Keep three real items when the meaning needs three.

> The summit offers keynote sessions, panel discussions, and networking blocks. Attendees leave with innovation, inspiration, and industry insight.

Rewritten:

> The summit has talks and panels, plus informal time between sessions.

**Paragraph scale:**

> A career can look promising and fail. A relationship can feel central and end. A skill can take years and stay useless. Decisions rarely explain themselves.

Rewritten:

> A career can look promising and fail. So can a relationship that felt central, or a skill that took years and stayed useless. Decisions rarely explain themselves.

#### Repeated openings

*Weak alone.*

Several sentences in a row start with the same subject, often she or he, because repetition is handled by rule instead of by ear. Merge the sentences, change the subject, or begin with the action. Do not ban the repeated word; one remaining sentence may still start with "She." Writers also repeat an opening on purpose for rhythm, as in "She came. She saw. She conquered."

> She noted the badge reader. She noted the deadbolt. She filed both away.

Rewritten:

> She noted the badge reader and the deadbolt, then filed both away.

#### Sentences cut to one length

*Act when a whole paragraph clusters in the same band.*

Generated sentences sit in a narrow band, often 18 to 28 words. Human prose bursts: a line of three words next to a line of thirty-five. After three or four regular-length sentences, place one very short sentence (3 to 8 words), then follow with one noticeably longer sentence (35 or more).

> The gateway validates the signature on each request. Every claim is checked against the allow list. Rejected calls return a 401 payload. Long sessions rely on a refresh token that rotates.

Rewritten:

> The gateway validates every signature. Claims are checked against the allow list. Rejections return 401. Refresh tokens rotate for long sessions, so a browser can stay signed in for days without replaying a stale token.

#### Formal connectors stacked at the head of sentences

*Weak alone; act when several appear in one paragraph.*

furthermore, moreover, additionally, consequently, notably, in summary, to summarize, as a result. Generated drafts lean on these far more than people do. The fix is not to ban connective language; it is to replace formal connectors with shorter, plainer joins.

> Furthermore, the service caches responses. Additionally, it retries failed calls. Moreover, it writes errors to the log.

Rewritten:

> The service also caches responses and retries failed calls. Errors go to the log.

#### Stacked qualifiers

*Weak alone.*

to be fair, it is also possible, could potentially, might arguably, in some cases it may, this is an inference. Repeated editing piles one qualifier on another until every claim sounds unsure, usually to repair an earlier overstatement rather than to report real doubt. Keep a qualifier only when the source supports it and the meaning needs it. Keep scope statements, legal and safety notices, and real corrections. Ordinary hedges such as perhaps or tends to are human habits, not tells.

> It could potentially possibly be argued that the rollout might have some effect on error rates.

Rewritten:

> The rollout may affect error rates.

#### Dashes used as the default joint

*Act on one sighting when several appear; a single dash is weak alone.*

**Rule for the final rewrite:** no em dashes (—) or en dashes (–) unless the writer's sample uses them; then match the sample's rate. Replace each dash with a period, comma, colon, or parentheses, or rewrite the sentence. This includes spaced dashes and double hyphens (` -- `) used as dashes. Leave dashes and hyphens inside code blocks, inline code, commands, paths, and URLs alone.

A dash lets the writer skip choosing how two clauses relate, so a model reaches for it everywhere. Many editors and journalists also use dashes, so one dash is weak alone; a text full of them is not.

> Rate limits — applied at the edge, not the origin — now sit at 100 requests per minute -- a level the docs still call preliminary.

Rewritten:

> Rate limits applied at the edge, not the origin, now sit at 100 requests per minute. The docs still call that level preliminary.

#### Passive voice and vanishing subjects

*Weak alone.*

The text hides who acts or drops the subject. Use active voice when it makes the actor and action clearer.

> No setup step needed. Records are written once confirmed.

Rewritten:

> You skip the setup step. The system writes records once it confirms them.

#### Hyphenated pairs in every position

*Weak alone.*

third-party, cross-functional, client-facing, data-driven, decision-making, well-known, high-quality, real-time, long-term, end-to-end. These pairs are hyphenated in every position. Keep the hyphen before a noun when grammar needs it (`a high-quality report`) and drop it after the noun (`the report is high quality`).

> The squad is cross-functional, the brief is high-quality, and the method is data-driven.

Rewritten:

> The squad is cross functional, the brief is high quality, and the method is data driven.

### Prospectus language

The fact underneath is usually sound. Keep it and strip the dressing.

#### Signature model vocabulary

*Act on one sighting for clusters; a single formal word outside the list is not a tell.*

The list: Actually, additionally, align with, bolstered, crucial, deep dive, delve, emphasizing, enduring, enhance, fostering, garner, gate/gated/gating (figurative; keep technical uses), highlight (verb), interplay, intricate/intricacies, key (adjective), landscape (abstract noun), meticulous/meticulously, pivotal, quietly, robust (figurative; keep technical uses), showcase, tapestry (abstract noun), testament, underscore (verb), valuable, vibrant, navigate, leverage, streamline, optimize, facilitate, cater to, pivot, commendable, crafted, curated, deepen, delve/delving, endured, entwining, evoked, faceted. Models use these far more than people do, especially in groups. This is the only vocabulary list in the skill. A formal word outside it is not a tell by itself.

> A deep dive into the ledger reveals a crucial interplay between fee tiers, showcasing a vibrant ecosystem of partners and bolstering the platform's role as a testament to durable design.

Rewritten:

> The ledger shows how fee tiers interact with partner payouts, which is how the platform keeps partners over time.

#### Inflated significance

*Act on one sighting.*

An ordinary detail is said to mark a change, prove a legacy, or promise a future: stands as a testament, a pivotal or crucial moment, plays a key role, marking or shaping the, underscores its importance, reflects a broader, enduring or lasting legacy, setting the stage for, evolving landscape, indelible mark; Despite these challenges... continues to thrive; Challenges and Legacy; Future Outlook; the future looks bright; exciting times ahead; a step in the right direction. The move appears at three scales: a phrase, a stock challenges-and-outlook section, and a send-off paragraph. Keep the fact and drop the significance. End on the last concrete fact; if the source states real plans, use those.

> The transit board was reconstituted in 2011, marking a pivotal moment in the evolution of urban mobility governance. Despite funding gaps, the agency continues to thrive as an integral part of the region's growth.

Rewritten:

> The transit board was reconstituted in 2011. The agency still runs short of funding.

**Send-off:**

> The future looks bright for the workshop. Exciting times lie ahead as the team pursues excellence.

Rewritten:

> (Cut the paragraph. End on the last concrete fact.)

#### Vague couplings

*Act when the source names a concrete relationship.*

The text says two things are connected without saying how: associated with, in association with, connected to, in connection with, linked to, tied to. "He was associated with the leadership of ExampleCorp" hides whether he was the CEO, a board member, or a consultant. Name the relationship the source gives. If the source does not say, keep the vague wording rather than inventing a role.

> He is associated with the chamber orchestra, which he founded and conducts. The recitals were organised in connection with the city's anniversary week.

Rewritten:

> He founded and conducts the chamber orchestra. The recitals were part of the city's anniversary week.

#### Trailing -ing riders

*Weak alone; act when the rider adds no source-backed claim.*

An -ing phrase is bolted onto a plain fact to make it sound deeper: highlighting, underscoring, emphasizing, ensuring, reflecting, symbolizing, contributing to, cultivating, fostering, encompassing, showcasing. Attaching it to a named source ("Ebert highlighted the lasting influence") does not make it true. Keep the fact; keep the rider only when the source supports what it claims.

> The hall's teal and copper scheme resonates with the river valley, symbolizing local industry and reflecting the town's bond with the water.

Rewritten:

> The hall is painted teal and copper, colors chosen to echo the river valley and the town's industry.

#### Brochure copy

*Act on one sighting.*

boasts, vibrant, rich (figurative), profound, enhancing, exemplifies, commitment to, natural beauty, nestled, in the heart of, groundbreaking (figurative), renowned, featuring, diverse array, breathtaking, must-visit, stunning. The text reads like an advertisement, especially for places, culture, products, or organizations. State what the thing is.

> Nestled within the rolling hills of the Finger Lakes, Aurora Cove stands as a vibrant hamlet with a rich heritage and stunning natural beauty.

Rewritten:

> Aurora Cove is a hamlet in the Finger Lakes hills.

#### Borrowed authority

*Act when the authority is unnamed; a missing citation alone is not a tell.*

experts argue, observers have cited, industry reports, some critics, several publications; cited, featured, or profiled in [a list of outlets], trade publications, independent coverage; active social media presence, over N followers. A name or an unnamed authority stands in for what was said. Unnamed experts prop up a claim; a list of prestige outlets props up a person. When the source text names the real source and what it said, use that. Otherwise cut the unsupported claim or the list. Never invent a source. Most writing is unsourced, so absence alone proves nothing.

**Unnamed expert:**

> Because of its unusual mineral mix, the gorge interests cavers and hydrologists. Experts believe it plays a crucial role in the local water table.

Rewritten:

> Cavers and hydrologists study the gorge for its unusual mineral mix.

**Prestige list:**

> Her readings have appeared in Variety, Pitchfork, and The Quietus. She keeps an active profile with over 400,000 followers.

Rewritten:

> Her readings have appeared in Variety and Pitchfork.

#### Long phrases standing in for is, are, and has

*Act on one sighting for serves as / stands as clusters.*

serves as, stands as, functions as, operates as, marks, represents [a]; boasts, features, offers, maintains [a]; refers to. Simple verbs are replaced with longer phrases. Use is, are, and has.

> Room B serves as the archive's reading space. The room features six carrels and boasts climate control.

Rewritten:

> Room B is the archive's reading room. It has six carrels and climate control.

### Page furniture

Templates and visual editors also produce clean formatting. The tell is decoration on every item.

#### Bold used as decoration

*Act on one sighting for lists where every item is labeled.*

Words are bolded without a reason, and vertical lists give every item a bold label and a colon. Remove the bold. Turn a labeled list into prose when the labels carry no information of their own.

> It combines **goal trees**, **pulse surveys**, and whiteboard tools like the **retro board**.

Rewritten:

> It combines goal trees, pulse surveys, and a retro board.

**Labeled list:**

> - **Latency:** Latency improved with the new cache layer.
> - **Errors:** Errors dropped after the retry policy.
> - **Cost:** Cost fell once we right-sized the fleet.

Rewritten:

> The new cache layer cut latency. The retry policy dropped errors. Right-sizing the fleet lowered cost.

#### Decorative headings

*Act on one sighting.*

Headings capitalize every main word, and headings or list items carry emojis or arrows (→) as decoration. A horizontal rule sits between every section, or the document opens with a top-level heading that repeats its own title. Use sentence case, remove the decoration and the rules, and let the title stand once.

> ## Release Cadence And Version Hygiene

Rewritten:

> ## Release cadence and version hygiene

**Embellished items:**

> 🚀 **Rollout:** The feature ships in Q4
> 💡 **Takeaway:** Users prefer fewer screens

Rewritten:

> The feature ships in Q4. User research showed a preference for fewer screens.

#### Curly quotation marks

*Weak alone.*

Curly quotes ("...") appear where the writer or target format uses straight quotes ("..."). Most editors auto-curl, so this is weak alone.

> She called the estimate "aggressive but reachable" in the memo.

Rewritten:

> She called the estimate "aggressive but reachable" in the memo.

### Fragments that belong elsewhere

Remove these outright. Nothing here needs rewriting.

#### Chat interface residue

*Act on one sighting; the most certain tell in the catalogue.*

A chatbot's greeting, praise, offer, or closing remains in text that should stand on its own: I hope this helps, Of course!, Certainly!, Great question!, You're absolutely right, Would you like..., Want me to...?, Should I continue?, let me know, here is a... The easiest miss is when the wrapper hugs real content. Strip the wrapper and keep the content.

> Great question! Here is a quick look at the 1913 textile strike. Wages had been frozen for two years when the walkout started. I hope this helps! Let me know if you would like another section expanded.

Rewritten:

> The 1913 textile strike started after two years of frozen wages.

#### Notes about where the model stops knowing

*Act on one sighting; never let a guess stand as fact.*

as of [date], up to my last training update, while specific details are limited, based on available information, not publicly available, not widely documented or disclosed, in the provided or available sources, maintains a low profile, keeps personal details private, likely [grew up, studied, began], it is believed that. The text marks where the model's knowledge ends, or admits it found no source and then fills the gap with a plausible guess. State what the source does not show, or remove the sentence. Never present a guess as a fact.

**Cutoff note:**

> While details of the merger are not extensively documented in readily available sources, the deal appears to have closed in the late 1990s.

Rewritten:

> The merger's closing date is not documented in the available sources. (Or cut the sentence.)

**Guess:**

> Public records of her schooling are scarce, suggesting a private upbringing. She likely studied abroad, which would explain the accent noted in profiles.

Rewritten:

> Her schooling is not documented in the available sources. (Or omit the section.)

#### The heading said again in the first line

*Act on one sighting.*

A heading is followed by a one-line paragraph that restates it before the real content begins. Remove the repeated sentence.

> ## Cache invalidation
>
> Cache invalidation matters.
>
> A stale entry can outlive the write that should have replaced it.

Rewritten:

> ## Cache invalidation
>
> A stale entry can outlive the write that should have replaced it.

#### Narration about the version that came before

*Act on one sighting outside change logs.*

Documentation and comments describe what the text replaced instead of the current behavior. Mention the previous version only in change logs, release notes, migration guides, and other documents about change.

> This flag was added because the old default flipped too many records at once.

Rewritten:

> The flag limits how many records flip in one batch. The default now caps the batch size.

