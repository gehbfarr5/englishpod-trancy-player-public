import glob
import os
import re
import pymupdf

# ⚠️ 源数据根目录：不再硬编码本机绝对路径（原默认值内含压缩包密码）。
#    请通过环境变量 EP_SOURCE_DIR 配置源文件目录（含 0001..0365 子目录），例如：
#        export EP_SOURCE_DIR="/path/to/englishpod源文件"
BASE_DIR = os.environ.get("EP_SOURCE_DIR", "")


def require_source_dir() -> str:
    """返回可用的源目录；未配置或目录不存在时抛出带说明的中文错误。"""
    if not BASE_DIR:
        raise RuntimeError(
            "未配置源目录：请设置环境变量 EP_SOURCE_DIR 指向 EnglishPod 源文件目录"
            "（内含 0001..0365 等课程子目录），例如：\n"
            '    export EP_SOURCE_DIR="/path/to/englishpod源文件"'
        )
    if not os.path.isdir(BASE_DIR):
        raise RuntimeError(f"EP_SOURCE_DIR 指向的目录不存在：{BASE_DIR}")
    return BASE_DIR

# Genuine verbatim Host + Dialogue script for Episode 08 (C0008 - What's your name again?)
# Note: In the source dataset, "主持人对话文本/008 - What's Your Name Again.pdf" was erroneously
# a duplicate of "009 - Silence please!.pdf". This script was transcribed and verified directly
# from 0008/englishpod_C0008pb.mp3 + 0008/englishpod_C0008.pdf.
LESSON_0008_HOST_SCRIPT = [
    ("M", "Hello English learners and welcome back to EnglishPod! My name is Marco."),
    ("E", "And I'm Erica."),
    ("M", "How are you, Erica?"),
    ("E", "Marco, I'm doing really well today."),
    ("M", "You're excited."),
    ("E", "Uh-huh, we've got a great lesson for everyone."),
    ("M", "Yes, we have a really common situation where we're going to use real English, right?"),
    ("E", "Yep, everyday English, English that people really use."),
    ("M", "And that's what we want you to learn. What are we talking about today specifically?"),
    ("E", "Today we have a really common situation that is a little bit embarrassing."),
    ("M", "Alright, an embarrassing situation. So let's listen to the dialogue for the first time and it's going to be kind of fast."),
    ("E", "Yeah, but don't worry if you don't understand everything, because after ten minutes you'll understand everything."),
    ("M", "Perfect. Alright, let's listen."),
    ("SECTION", "DIALOGUE, FIRST TIME"),
    ("E", "Wow, Nick forgot her name."),
    ("M", "Yeah, that's happened to me a couple of times and I'm going to tell you about it a little bit later."),
    ("E", "Okay, alright. Well, let's start with our three language takeaways."),
    ("Voice", "Language takeaway."),
    ("M", "So our first word on our language takeaway is in a bit of a hurry."),
    ("E", "In a bit of a hurry."),
    ("M", "In a bit of a hurry."),
    ("E", "In a bit of a hurry."),
    ("M", "So Nick was in a hurry."),
    ("E", "Yeah, that's right. This is a great phrase, so let's listen to three examples of how you can use this phrase."),
    ("Voice", "Example one."),
    ("A", "Can you drive faster? I'm in a bit of a hurry."),
    ("Voice", "Example two."),
    ("B", "I can't talk right now; I'm in a bit of a hurry."),
    ("Voice", "Example three."),
    ("C", "I'm in a bit of a hurry, so I'll check these files later."),
    ("E", "Okay, so it's clear now."),
    ("M", "Basically, it means that you don't have time."),
    ("E", "You're moving really quickly."),
    ("M", "Okay, perfect. Now let's look at our second language takeaway word and it's contact details."),
    ("E", "Contact details."),
    ("M", "Contact details."),
    ("E", "Contact details."),
    ("M", "So what are your contact details?"),
    ("E", "Basically, this is the information you can find on your business card."),
    ("M", "Alright, so we have like our name, our telephone number, your email address..."),
    ("E", "Perhaps your mobile phone number."),
    ("M", "So all the useful information so people can get in touch with you."),
    ("E", "Yep, so people can phone you or email you. Okay, so contact details."),
    ("M", "Great. Okay, so our third word is slipped my mind."),
    ("E", "Slipped my mind."),
    ("M", "Slipped my mind."),
    ("E", "Slipped my mind."),
    ("M", "So this is a funny phrase. It's kind of strange, right?"),
    ("E", "Yes, slipped my mind. It sounds very weird."),
    ("M", "Exactly."),
    ("E", "Okay, so now we're going to listen to two examples of this phrase. Try and see if you can figure out what it means."),
    ("Voice", "Example one."),
    ("A", "I'm sorry I forgot to respond to your email; it just slipped my mind."),
    ("Voice", "Example two."),
    ("B", "Don't you know what day it is today?"),
    ("C", "Oh, it's your birthday! It completely slipped my mind."),
    ("E", "Aha, so slipped my mind is like I forgot."),
    ("M", "You forgot something."),
    ("E", "So accidentally. Right."),
    ("M", "Okay, great. Now it's time for putting it together."),
    ("Voice", "Putting it together."),
    ("M", "Alright, Erica, why don't you tell our listeners what putting it together is?"),
    ("E", "Well, putting it together helps you put language together. It helps you be more fluent by knowing how words fit together."),
    ("M", "Great."),
    ("E", "So let's look at our first phrase today."),
    ("M", "And it's around here."),
    ("E", "Around here."),
    ("M", "Around here."),
    ("E", "Around here. So this is like close by."),
    ("M", "Close by, right?"),
    ("E", "Yeah, yeah. So that's, is there a bank close to here?"),
    ("M", "Exactly."),
    ("E", "Now this phrase around here, we can change it a little bit and it means something a little bit different."),
    ("M", "Right."),
    ("E", "I could say, Marco, there's a great restaurant right around the corner."),
    ("M", "Right. And that would mean there is a great restaurant on the other street."),
    ("E", "Yep."),
    ("M", "Around the corner."),
    ("E", "Yep."),
    ("M", "Great. Or we have another example. We can say around there."),
    ("E", "Around there."),
    ("M", "Right. So for example, I can say Los Angeles is a great city. I used to live around there."),
    ("E", "So you used to live near Los Angeles?"),
    ("M", "Exactly."),
    ("E", "Alright."),
    ("M", "It's a really good phrase and it's really common."),
    ("E", "Yeah. Now our next phrase in putting it together is terrible with."),
    ("M", "Terrible with."),
    ("E", "Terrible with."),
    ("M", "Terrible with. So we have a couple of examples that will show you how this phrase works."),
    ("Voice", "Example one."),
    ("A", "You're terrible with numbers; you can't even remember your own telephone number."),
    ("Voice", "Example two."),
    ("B", "I'm terrible with directions; I'm always getting lost."),
    ("Voice", "Example three."),
    ("C", "I'm terrible with faces; I can never remember what people look like."),
    ("E", "Wow, I understand that. I'm also terrible with numbers; I can barely add two plus two."),
    ("M", "Well, yeah, I guess not everyone is a numbers person. I'm terrible with faces; I sometimes forget what people look like."),
    ("E", "Really?"),
    ("M", "Uh-huh. So I think it's time now for us to listen to our dialogue a second time."),
    ("E", "Okay, this time the dialogue will be a little bit slower, so try and listen for some of the words we've just talked about."),
    ("SECTION", "DIALOGUE, SECOND TIME (slow)"),
    ("E", "So it's more clear now."),
    ("M", "You can understand a lot better, right?"),
    ("E", "Yeah, that's true."),
    ("M", "Great. So now it's time for us to take a look at fluency builder."),
    ("Voice", "Fluency builder."),
    ("E", "So with fluency builder, we take some very simple phrases and show you how you can be more fluent. Or how you can..."),
    ("M", "Sound more native."),
    ("E", "Yeah."),
    ("M", "Great. In the beginning of the dialogue, Anna said, \"Nick! How's it going?\""),
    ("E", "Yeah, this is a great phrase. It sounds really, really natural. You know, sometimes I hear students say, \"How are you?\""),
    ("M", "Or \"How are you doing?\""),
    ("E", "Those are two great phrases, but this one sounds really, really natural."),
    ("M", "It just sounds more casual."),
    ("E", "Yeah, let's listen again to that phrase from the dialogue."),
    ("Phrase 1", "How's it going?"),
    ("Phrase 1", "How's it going?"),
    ("M", "Great. So next time that you find a friend on the street, you can just say, \"Hey, how's it going?\""),
    ("E", "Yeah. So Marco, have you ever forgotten someone's name?"),
    ("M", "Yeah, it's happened to me a couple of times. And actually, the most embarrassing situation was that I forgot a family member's name."),
    ("E", "No! A family member's name?"),
    ("M", "We had like a family reunion and there were a lot of aunts and uncles and cousins that I hadn't seen in a while, and I just forgot one of my uncle's names."),
    ("E", "Oh, that's pretty embarrassing. So what did you do?"),
    ("M", "Well, I had to ask one of my other cousins. I'm like, \"Hey, who is that guy?\" He's like, \"Oh, that's Uncle John.\" I'm like, \"Oh man, I totally forgot.\""),
    ("M", "Yeah, so it was really embarrassing because I didn't know what to call him, so I just called him Uncle because I didn't know his name."),
    ("E", "Hi Uncle!"),
    ("M", "Yeah."),
    ("E", "Oh, yeah. So when that happens to me when I'm in a business setting, sometimes what I do is I ask for someone's card."),
    ("M", "Yeah, that's a good technique."),
    ("E", "Yeah. Or sometimes I might ask them to write down their email, because usually their full name is spelled out in their email address. So that's my trick when I've forgotten someone's name."),
    ("M", "That's a good trick. And I guess a lot of our listeners can take your advice on that."),
    ("E", "Okay, so I think it's time for us to listen to our dialogue one more time, this time at natural speed."),
    ("SECTION", "DIALOGUE, THIRD TIME"),
    ("E", "Well, I hope that you've all enjoyed our lesson for today. And remember to check out our website at englishpod.com."),
    ("M", "Where you can find a lot of other resources and you can leave all your questions and comments."),
    ("E", "Yeah, Marco and I are always on the site, so we're happy to answer all of your questions."),
    ("M", "Exactly, so now it's time for us to say goodbye."),
    ("E", "Bye!"),
    ("M", "Goodbye!"),
]

# Genuine compound prefixes that retain a hyphen when wrapped across lines
COMPOUND_PREFIXES = {
    "two", "three", "one", "four", "five", "six", "ten", "twenty", "thirty",
    "forty", "fifty", "first", "second", "self", "well", "non", "anti",
    "multi", "inter", "counter", "cross", "mid", "half", "full", "part",
    "high", "low", "free", "short", "long", "no", "far", "employee",
}


def clean_ligatures(t: str) -> str:
    replacements = [
        ("ﬁ", "fi"), ("ﬂ", "fl"), ("ﬀ", "ff"), ("ﬃ", "ffi"), ("ﬄ", "ffl"),
        ("’", "'"), ("‘", "'"), ("‟", "'"), ("‚", "'"),
        ("“", '"'), ("”", '"'), ("„", '"'),
        ("–", "-"), ("—", "-"), ("…", "..."), ("\u00a0", " "),
        ("country[s]", "countries"), ("mor[t]gage", "mortgage"), ("Mor[t]gage", "Mortgage"),
        ("[we]", "we"),
    ]
    for k, v in replacements:
        t = t.replace(k, v)
    # Remove unspoken editorial comments/notes such as [NOTE: ...] or [Comment: ...]
    t = re.sub(r"\s*\[(?:NOTE|Comment):.*?\]", "", t, flags=re.IGNORECASE)
    # Remove transcriber timestamp annotations like ??? 3:33, ?6:56, 2:13?, 7:52??, 11:51??
    t = re.sub(r"\?+\s*\d{1,2}:\d{2}\b", "", t)
    t = re.sub(r"\b\d{1,2}:\d{2}\s*\?+", "", t)
    t = re.sub(r"\(\s*[a-zA-Z']*?\?+\s*(?:\d{1,2}:\d{2})?\s*\)", "", t)
    # Remove decorative asterisk markers
    t = re.sub(r"\*{2,}", "", t)
    return t.strip()


def join_lines(lines: list[str]) -> str:
    out = ""
    for l in lines:
        l = l.strip()
        if not l:
            continue
        if out.endswith("-") and l and l[0].islower():
            prefix_words = re.split(r"[\s-]+", out[:-1])
            prefix = prefix_words[-1].lower() if prefix_words else ""
            if prefix in COMPOUND_PREFIXES:
                out += l
            else:
                out = out[:-1] + l
        else:
            out = (out + " " + l).strip()
    out = clean_ligatures(out)
    return re.sub(r"\s+", " ", out).strip()


SPECIAL_EPISODES = {
    66: {
        "vocab": [
            {"type": "key", "word": "oo-flay (flu)", "pos": "noun", "definition": "an infectious illness like a bad cold causing fever and body aches"},
            {"type": "key", "word": "alling-cay in ick-say (calling in sick)", "pos": "phrase", "definition": "phoning your workplace to report that you cannot come to work due to illness"},
            {"type": "key", "word": "eecover-ray (recover)", "pos": "verb", "definition": "to get better and return to normal health after an illness"},
        ],
    },
    156: {
        "vocab": [
            {"type": "key", "word": "outskirts", "pos": "noun", "definition": "the outer parts of a town or city"},
            {"type": "key", "word": "eerie", "pos": "adjective", "definition": "strange and frightening in a mysterious way"},
            {"type": "key", "word": "ghoulish", "pos": "adjective", "definition": "resembling a terrifying phantom or evil spirit"},
            {"type": "key", "word": "jammed", "pos": "adjective", "definition": "stuck fast and unable to move or open"},
            {"type": "key", "word": "ward off", "pos": "phrase", "definition": "to keep someone or something dangerous away"},
        ],
    },
    164: {
        "vocab": [
            {"type": "key", "word": "ruin", "pos": "verb", "definition": "to damage or destroy something completely"},
            {"type": "key", "word": "mean the world to", "pos": "phrase", "definition": "to be extremely important and precious to someone"},
            {"type": "key", "word": "hold onto", "pos": "phrase", "definition": "to keep and not let go of something valuable"},
            {"type": "key", "word": "jeopardize", "pos": "verb", "definition": "to put something important in danger of being lost or harmed"},
            {"type": "key", "word": "get through", "pos": "phrase", "definition": "to manage to survive or deal with a difficult period"},
        ],
    },
    168: {
        "dialogues": [
            {"speaker": "A", "text": "Hello everyone and welcome back to our show. Today we are going to learn how to cook the perfect Thanksgiving turkey. I will share a secret that I have kept for over 30 years on how to cook the perfect, most mouthwatering, juiciest turkey in the world. Let's get started!"},
            {"speaker": "A", "text": "First of all, we must bring out our key ingredient, whiskey. You see, the grains used to make whiskey along with the alcohol brings out the flavor of the turkey meat. Let's pour one cup of whiskey on the turkey and serve yourself a cup as well. Cheers! That's good 12 year whiskey right there."},
            {"speaker": "A", "text": "Okay, back to our turkey. Preheat your oven to 475 degrees Fahrenheit. Now have another cup of whiskey. Now that the oven is hot, we place our bird on a rack inside a roasting pan. Let's add some whiskey to give it some extra flavor. And let's have another cup. Ah, that hit the spot."},
            {"speaker": "A", "text": "There we go. We can leave it in there for the next 45 minutes. In the meantime, let's have another sip of whiskey and start with our delicious pumpkin pie. Lightly whisk together two eggs and the extra yolk in a large bowl. Once that's ready, we can put sugar, spices such as cloves, grated nutmeg, and cinnamon with some cream and dark rum into a saucepan. Slowly bring up to simmering point, stirring occasionally."},
            {"speaker": "A", "text": "Now you may notice that we are using some dark rum in this pie. This is because the richness of the pumpkin is beautifully enhanced by the dark rum. So to celebrate this great occasion, pour yourself a glass. Cheers! Now that we have finished with the filling, let's bake the pie for 45 to 50 minutes until the filling has puffed up around the edges and the center is almost set. All done! A cup of rum to celebrate the completion of this great Thanksgiving dinner."},
            {"speaker": "A", "text": "After waiting for an hour and having a couple of drinks, it's time to check on our turkey. Take the turkey out of the oven. Pick the turkey off of the ground. Don't worry, it will add flavor to this recipe. Now also remove the pie from the oven and serve while still hot. Cheers and happy Thanksgiving!"},
        ],
        "key_vocab": [
            {"type": "key", "word": "mouthwatering", "pos": "adjective", "definition": "smelling, looking, or sounding delicious"},
            {"type": "key", "word": "preheat", "pos": "verb", "definition": "to heat an oven to a designated temperature before using it"},
            {"type": "key", "word": "roasting pan", "pos": "noun", "definition": "a large open pan used for cooking meat in an oven"},
            {"type": "key", "word": "hit the spot", "pos": "phrase", "definition": "to be exactly what is needed or wanted, providing great satisfaction"},
            {"type": "key", "word": "simmer", "pos": "verb", "definition": "to cook liquid gently just below the boiling point"},
        ],
    },
    206: {
        "title": "Elementary - Daily Life - Talking To Your Roommate (C0206)",
        "dialogues": [
            {"speaker": "A", "text": "Charlie, do you have a second?"},
            {"speaker": "B", "text": "Yeah, what's up?"},
            {"speaker": "A", "text": "Well, I went and paid the bills today and you still haven't given me your half."},
            {"speaker": "B", "text": "Yeah, I wanted to talk to you about that. I agreed we would go halves on all the bills, but frankly I think it's unfair."},
            {"speaker": "A", "text": "Unfair! Why?"},
            {"speaker": "B", "text": "Well, you have long hair and use the hairdryer every morning. I don't. You leave your computer on all night downloading torrents. I don't. You see what I'm getting at here?"},
            {"speaker": "A", "text": "You leave the air conditioner on day and night! You also take 30 minute showers which means you are using way more gas and water than me!"},
            {"speaker": "B", "text": "Well, while we are at it, stop bringing your friends over for drinks every weekend. You always leave a mess and keep me up all night!"},
            {"speaker": "A", "text": "Maybe you should just move out and find another place."},
            {"speaker": "B", "text": "Maybe you should move out!"},
        ],
        "vocab": [
            {"type": "key", "word": "bill", "pos": "noun", "definition": "a document that shows how much money you must pay"},
            {"type": "key", "word": "go halves", "pos": "phrase", "definition": "divide the cost of something equally between two people"},
            {"type": "key", "word": "torrent", "pos": "noun", "definition": "a peer-to-peer file used for downloading movies or music from the Internet"},
            {"type": "key", "word": "move out", "pos": "verb", "definition": "to vacate a residence and leave for a new place to live"},
            {"type": "key", "word": "place", "pos": "noun", "definition": "an informal word for someone's home or apartment"},
            {"type": "supplementary", "word": "what's up", "pos": "phrase", "definition": "informal greeting asking what is new or happening"},
            {"type": "supplementary", "word": "see what I'm getting at", "pos": "phrase", "definition": "understand the point I am hinting at or trying to say"},
            {"type": "supplementary", "word": "way more", "pos": "phrase", "definition": "much more, or a lot more (spoken English)"},
        ],
    },
}


def parse_dialogue_pdf(pdf_path: str, ep_num: int | None = None):
    if ep_num == 206 and (not pdf_path or not os.path.exists(pdf_path)):
        spec = SPECIAL_EPISODES[206]
        return spec["title"], list(spec["dialogues"]), list(spec["vocab"])

    doc = pymupdf.open(pdf_path)
    section = "dialogue"
    title = ""
    dialogues = []
    cur_speaker = None
    cur_lines = []
    vocab_rows = []

    pending_spk_parts = []

    for pno, page in enumerate(doc):
        page_lines = []
        for b in page.get_text("dict")["blocks"]:
            if "lines" not in b:
                continue
            for l in b["lines"]:
                y0 = l["bbox"][1]
                if y0 > 770:
                    continue
                txt = clean_ligatures("".join(s["text"] for s in l["spans"]).strip())
                if (
                    not txt
                    or txt.startswith("Visit the Online Review")
                    or "Praxis Language" in txt
                    or "Learn English on Your Terms" in txt
                    or txt == "EnglishPod"
                ):
                    continue
                page_lines.append((l["bbox"][0], y0, txt))
        page_lines.sort(key=lambda item: (round(item[1] / 2.0) * 2.0, item[0]))

        dlg_x_candidates = [
            x
            for x, y, t in page_lines
            if not (pno == 0 and y < 160 and (y < 130 or re.search(r"\([A-Z]\d{4}\)$", t)))
            and t not in ("Key Vocabulary", "Supplementary Vocabulary")
            and x >= 125
            and len(t) >= 10
        ]
        dlg_col_x = min(dlg_x_candidates) - 3.0 if dlg_x_candidates else 125.0
        dlg_col_x = min(202.0, max(122.0, dlg_col_x))

        for x, y, txt in page_lines:
            if pno == 0 and not title:
                title = txt
                continue
            # Handle wrapped 2-line title / lesson code on page 0 (e.g. "(B0023)" or "tion (C0235)")
            if pno == 0 and y < 160 and re.search(r"\([A-Z]\d{4}\)$", txt):
                if txt not in title:
                    title = join_lines([title, txt])
                continue
            if txt == "Key Vocabulary":
                if cur_speaker and cur_lines:
                    dialogues.append({"speaker": cur_speaker, "text": join_lines(cur_lines)})
                    cur_speaker, cur_lines, pending_spk_parts = None, [], []
                section = "key_vocab"
                continue
            elif txt == "Supplementary Vocabulary":
                if cur_speaker and cur_lines:
                    dialogues.append({"speaker": cur_speaker, "text": join_lines(cur_lines)})
                    cur_speaker, cur_lines, pending_spk_parts = None, [], []
                section = "supp_vocab"
                continue

            if section == "dialogue":
                if x < dlg_col_x:
                    m_inline = re.match(r"^([A-Za-z0-9\.\s,]{1,18}?):+\s*(.+)$", txt)
                    if m_inline and not txt.endswith(":"):
                        if cur_speaker and cur_lines:
                            dialogues.append({"speaker": cur_speaker, "text": join_lines(cur_lines)})
                        cur_speaker = m_inline.group(1).strip()
                        cur_lines = [m_inline.group(2).strip()]
                        pending_spk_parts = []
                    elif txt.endswith(":"):
                        spk_piece = txt.rstrip(":").strip()
                        if pending_spk_parts:
                            pending_spk_parts.append(spk_piece)
                            cur_speaker = join_lines(pending_spk_parts)
                            pending_spk_parts = []
                        else:
                            if cur_speaker and cur_lines:
                                dialogues.append({"speaker": cur_speaker, "text": join_lines(cur_lines)})
                            cur_speaker = spk_piece
                            cur_lines = []
                    else:
                        if not pending_spk_parts:
                            if cur_speaker and cur_lines:
                                dialogues.append({"speaker": cur_speaker, "text": join_lines(cur_lines)})
                            pending_spk_parts = [txt]
                            cur_speaker = txt
                            cur_lines = []
                        else:
                            pending_spk_parts.append(txt)
                            cur_speaker = join_lines(pending_spk_parts)
                else:
                    if cur_speaker is None:
                        cur_speaker = "Narrator"
                    cur_lines.append(txt)
            else:
                vocab_rows.append((section, pno, y, x, txt))

    if cur_speaker and cur_lines:
        dialogues.append({"speaker": cur_speaker, "text": join_lines(cur_lines)})

    camel_whitelist = {
        "McNealy", "McKenna", "MacDonald", "DaMarco", "McCormick", "PowerPoint",
        "SpanishPod", "PayPal", "EnglishPod", "McGraw", "MeGee", "MePhone",
        "AmLion", "DeGeneres", "DiCaprio", "LaGuardia", "LeBron", "iPod",
        "iPhone", "iPad", "eBay", "YouTube", "MySpace",
    }

    def fix_cms_merged_words(text: str) -> str:
        """Fix missing spaces caused by Praxis Language CMS XML tag stripping in dialogue PDFs."""
        def repl_camel(m):
            w = m.group(0)
            if w in camel_whitelist or w.startswith(("Mc", "Mac")):
                return w
            return f"{m.group(1)} {m.group(2)}"

        text = re.sub(r"\b([A-Za-z]*[a-z])([A-Z][a-z]*)\b", repl_camel, text)
        text = re.sub(r"\b([A-Za-z]+'(?:s|t|re|ve|ll|d|m))([a-zA-Z]{2,})\b", r"\1 \2", text)
        text = text.replace("Le'ts", "Let's")

        fn_merges = [
            (r"\b(on|of|in|to|at|for|with|by|from|all|is|are|was|were|what|achieve|and|as|up|or)(the)\b", r"\1 \2"),
            (r"\b(the)(stockings|Armistice|flu)\b", r"\1 \2"),
            (r"\b(Day|job|belts|Bill)(and)\b", r"\1 \2"),
            (r"\b(baggage|rent)(is|isso)\b", lambda m: f"{m.group(1)} is" if m.group(2).lower() == "is" else f"{m.group(1)} is so"),
            (r"\b(How)(are)\b", r"\1 \2"),
            (r"\b(steering\s+wheel)(firmly)\b", r"\1 \2"),
            (r"\b(mirrors)(to)\b", r"\1 \2"),
            (r"\b(go)(good)\b", r"\1 \2"),
            (r"\b(deceased)(using)\b", r"\1 \2"),
            (r"\b(rip\s+off)(don't)\b", r"\1 \2"),
            (r"\b(throw\s+up)(or)\b", r"\1 \2"),
            (r"\b(implants)(as)\b", r"\1 \2"),
            (r"\b(surgery)(to|hurts)\b", r"\1 \2"),
            (r"\b(terms)(of)\b", r"\1 \2"),
            (r"\b(score)(in)\b", r"\1 \2"),
            (r"\b(times)(for)\b", r"\1 \2"),
            (r"\b(dozen)(long)\b", r"\1 \2"),
            (r"\b(to)(talking)\b", r"\1 \2"),
            (r"\b(you)(killing)\b", r"\1 \2"),
        ]
        for pat, rep in fn_merges:
            text = re.sub(pat, rep, text, flags=re.IGNORECASE if isinstance(rep, str) else 0)
        return text

    # Fix known PDF truncation in C0019 ("the state will appoint" -> "the state will appoint one for you.")
    # and repair CMS tag-merged words across all episodes
    for d in dialogues:
        if d["text"].endswith("the state will appoint"):
            d["text"] += " one for you."
        d["text"] = fix_cms_merged_words(d["text"])

    # Group vocab_rows by horizontal row (within 4pt of y) to accurately detect new entries vs wrapped lines
    rows_by_y = []
    for sec, pno, y, x, txt in vocab_rows:
        if rows_by_y and rows_by_y[-1]["sec"] == sec and rows_by_y[-1]["pno"] == pno and abs(y - rows_by_y[-1]["y"]) < 4.5:
            rows_by_y[-1]["cells"].append((x, txt))
        else:
            rows_by_y.append({"sec": sec, "pno": pno, "y": y, "cells": [(x, txt)]})

    entries = []
    for row in rows_by_y:
        sec, pno, y, cells = row["sec"], row["pno"], row["y"], row["cells"]
        word_cells = [txt for x, txt in cells if x < 230]
        pos_cells = [txt for x, txt in cells if 230 <= x < 340]
        def_cells = [txt for x, txt in cells if x >= 340]

        if word_cells:
            prev_word_hyphen = entries and entries[-1]["word_lines"][-1].endswith("-")
            pos_is_new_header = bool(pos_cells) and not prev_word_hyphen and not pos_cells[0].endswith(")")
            is_continuation = (
                entries
                and entries[-1]["sec"] == sec
                and entries[-1]["pno"] == pno
                and (y - entries[-1]["last_word_y"]) < 23.0
                and not (pos_is_new_header and entries[-1]["pos_lines"])
            )
            if is_continuation:
                entries[-1]["word_lines"].extend(word_cells)
                entries[-1]["last_word_y"] = y
                entries[-1]["pos_lines"].extend(pos_cells)
                entries[-1]["def_lines"].extend(def_cells)
            else:
                entries.append({
                    "sec": sec,
                    "pno": pno,
                    "start_y": y,
                    "last_word_y": y,
                    "word_lines": list(word_cells),
                    "pos_lines": list(pos_cells),
                    "def_lines": list(def_cells),
                })
        elif entries and entries[-1]["sec"] == sec:
            entries[-1]["pos_lines"].extend(pos_cells)
            entries[-1]["def_lines"].extend(def_cells)

    vocab = []
    for e in entries:
        w = join_lines(e["word_lines"])
        if w == "in bit of a hurry":
            w = "in a bit of a hurry"
        p = join_lines(e["pos_lines"])
        df = join_lines(e["def_lines"])
        if w:
            vocab.append({
                "type": "key" if e["sec"] == "key_vocab" else "supplementary",
                "word": w,
                "pos": p,
                "definition": df,
            })

    if ep_num is None and pdf_path:
        m_ep = re.search(r"(\d{4})", os.path.basename(pdf_path))
        if m_ep:
            ep_num = int(m_ep.group(1))

    if ep_num in SPECIAL_EPISODES:
        spec = SPECIAL_EPISODES[ep_num]
        if not dialogues and "dialogues" in spec:
            dialogues = list(spec["dialogues"])
        if "key_vocab" in spec:
            vocab = list(spec["key_vocab"]) + vocab
        elif not vocab and "vocab" in spec:
            vocab = list(spec["vocab"])

    return title, dialogues, vocab


def _expand_script_with_dialogues(script_rows: list[tuple[str, str]], dialogue_turns: list[dict]) -> list[dict]:
    turns = []
    for spk, txt in script_rows:
        if spk == "SECTION" and txt.upper().startswith("DIALOGUE"):
            turns.append({"speaker": "SECTION", "text": txt, "is_section": True})
            for d in dialogue_turns:
                turns.append({
                    "speaker": d["speaker"],
                    "text": d["text"],
                    "is_section": False,
                    "in_dialogue_block": True,
                })
        elif spk == "SECTION":
            turns.append({"speaker": "SECTION", "text": txt, "is_section": True})
        else:
            turns.append({
                "speaker": spk,
                "text": txt,
                "is_section": False,
                "in_dialogue_block": False,
            })
    return turns


def parse_host_pdf(pdf_path: str, dialogue_turns: list[dict]):
    base_name = os.path.basename(pdf_path)
    # Override Episode 08 whose source PDF in 主持人对话文本/ was erroneously a duplicate of Episode 09
    if base_name.startswith("008"):
        return _expand_script_with_dialogues(LESSON_0008_HOST_SCRIPT, dialogue_turns)

    m_ep = re.match(r"^(\d+)", base_name)
    ep_num = int(m_ep.group(1)) if m_ep else 0

    doc = pymupdf.open(pdf_path)
    lines = []
    for page in doc:
        for line in page.get_text("text").splitlines():
            t = clean_ligatures(line.strip())
            if t:
                lines.append(t)

    turns = []
    cur_speaker = None
    cur_text = []

    def clean_turn_text(joined: str, spk: str) -> str:
        # Handle known standalone ??? lines verified against audio
        if joined in ("???", "???."):
            if ep_num == 31:
                return ""
            if ep_num == 90:
                return "Off air."
            if ep_num == 66:
                if spk == "A":
                    return "Our-fay eople-pay alling-cay in ick-say oday-tay."
                if spk == "B":
                    return "If ou-yay all-cay in ick-say one ore-may ime-tay, ou're-yay ired-fay."
                if spk == "C":
                    return "I'm ot-nay eeling-fay ell-way, so I'm alling-cay in ick-say."
        # Strip inline ??? or ?? and leading timestamps like "10:54 this guy..."
        joined = re.sub(r"^\d{1,2}:\d{2}\s+", "", joined)
        joined = re.sub(r"\s*\?{2,}\s*", " ", joined)
        return re.sub(r"\s+", " ", joined).strip()

    def flush():
        nonlocal cur_speaker, cur_text
        if cur_text:
            joined = clean_turn_text(join_lines(cur_text), cur_speaker or "")
            if joined:
                turns.append({
                    "speaker": cur_speaker or "",
                    "text": joined,
                    "is_section": cur_speaker == "SECTION",
                })
            cur_speaker = None
            cur_text = []

    for line in lines:
        upper = line.upper().rstrip(".")
        if re.match(r"^NO\s+(?:SECOND|THIRD)\s+DIALOGUE", upper):
            flush()
            continue
        if (
            upper in (
                "DIALOGUE, FIRST TIME",
                "DIALOGUE, SECOND TIME",
                "DIALOGUE, THIRD TIME",
                "DIALOGUE - FIRST TIME",
                "DIALOGUE - SECOND TIME",
            )
            or re.match(r"^DIALOGUE[,:\s-]+(FIRST|SECOND|THIRD|LAST|1ST|2ND|3RD)(?:\s+AND\s+LAST)?\s+TIME", upper)
        ):
            flush()
            clean_sec = re.sub(r"\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*$", "", line).strip()
            turns.append({"speaker": "SECTION", "text": clean_sec, "is_section": True})
            for d in dialogue_turns:
                turns.append({
                    "speaker": d["speaker"],
                    "text": d["text"],
                    "is_section": False,
                    "in_dialogue_block": True,
                })
            continue
        if re.match(r"^Example\s+(one|two|three|four|five|1|2|3|4|5)[\.:!]?$", line, re.IGNORECASE):
            flush()
            turns.append({"speaker": "SECTION", "text": line, "is_section": True})
            continue

        # Match either "M: text" or "M    text" / "C,M    text" / "c    text"
        m = re.match(r"^([A-Z][A-Za-z0-9\.\s,]{0,11}):\s*(.*)$", line)
        if not m:
            m = re.match(r"^([A-Za-z](?:,[A-Za-z])?|Voice)\s{2,}(.+)$", line)
        if m:
            flush()
            spk = m.group(1).strip()
            if len(spk) == 1:
                spk = spk.upper()
            cur_speaker = spk
            if m.group(2).strip():
                cur_text.append(m.group(2).strip())
        else:
            cur_text.append(line)

    flush()
    return turns


if __name__ == "__main__":
    source_dir = require_source_dir()
    all_ep_dirs = {}
    for p in glob.glob(f"{source_dir}/**/[0-9][0-9][0-9][0-9]", recursive=True):
        if os.path.isdir(p):
            all_ep_dirs[int(os.path.basename(p))] = p
    host_map = {}
    for p in glob.glob(f"{source_dir}/主持人对话文本/*.pdf"):
        m = re.match(r"^(\d+)", os.path.basename(p))
        if m:
            host_map[int(m.group(1))] = p

    print(f"Auditing {len(all_ep_dirs)} episodes ({len(set(all_ep_dirs.keys()) & set(host_map.keys()))} with host PDFs)...")
    bad = 0
    for ep in sorted(all_ep_dirs.keys()):
        d = all_ep_dirs[ep]
        pdfs = [x for x in glob.glob(f"{d}/*.pdf") if "intro" not in os.path.basename(x).lower()]
        dlg_pdf = pdfs[0] if pdfs else ""
        title, dlgs, voc = parse_dialogue_pdf(dlg_pdf, ep_num=ep)
        ht = parse_host_pdf(host_map[ep], dlgs) if ep in host_map else []
        if not title or len(dlgs) == 0 or len(voc) == 0 or (ep in host_map and len(ht) < 15):
            print(f"ANOMALY Ep {ep:04d} [{title}]: dlgs={len(dlgs)}, voc={len(voc)}, ht={len(ht)}")
            bad += 1
    print(f"Audit complete! Anomalies: {bad}")

