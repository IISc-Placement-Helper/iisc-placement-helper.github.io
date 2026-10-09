# My status: mailing each student their personal code

Every student needs a personal code to open My status: the Microsoft sign-in alone does not prove that someone owns
an `@iisc.ac.in` address, but a code that arrives in that inbox does. Codes are derived from `.code-secret` and the
address, so they never change unless you rotate that secret, and nothing needs to be stored. You mail them once with
a Word + Outlook mail merge from your IISc account; the app asks each student for the code once per device.

You need: Word and the classic Outlook desktop app for Windows, signed in with your IISc account. Word sends the
merge through classic Outlook; if you use the new Outlook, switch back to classic Outlook (the toggle at the top
right) for this. Outlook on the web cannot send a Word mail merge.

## 1. Make the list

In the repository folder:

```sh
node tools/status.mjs --codes                       # every address on any OCCaP list so far
node tools/status.mjs --codes --roster batch.csv    # plus every address in a roster (CSV with an Email column, optional Name column)
```

It writes `_work/hq_public/status/codes.csv` with the columns `email,code`, or `email,name,code` when the roster has
names, and prints counts only. Addresses are lower case and de-duplicated; roster rows that are not IISc addresses
are skipped and counted. The file names students and holds their codes: keep it on your machine, never attach it
to anything, and delete it after the merge (the same command makes it again any time).

## 2. Set up the merge in Word

1. Open Word, a blank document. **Mailings**, **Start Mail Merge**, **E-mail Messages**.
2. **Select Recipients**, **Use an Existing List**, choose `codes.csv` (set the file type box to *All Data Sources*
   or *Text Files* if it is not listed). If Word asks how the file is split: *Delimited*, field delimiter *Comma*,
   record delimiter *Enter*.
3. Paste the message below. Put the cursor where each field goes and use **Insert Merge Field**: `name` after "Hi"
   (or delete it and write just "Hi," if your file has no names), and `code` on its own line.
4. **Preview Results** and step through a few recipients: each mail must show that student's own code.

### Subject

```
Your personal code for Placement HQ (My status)
```

### Message

```
Hi «name»,

Here is your personal code for My status in Placement HQ:

«code»

My status shows your own OCCaP shortlists, waitlists and results. Open the Status tab, sign in with your IISc
Microsoft account (this address), and enter the code once on each device you use.

Keep this code private: together with your IISc sign-in it opens your entries, so do not share or forward it.
If you lose it, reply to this mail and it will be sent again.

Placement HQ is not an official OCCaP service; the OCCaP mail remains the source of truth.

OCCaP-helper
```

Sign it as *OCCaP-helper*, the name the app shows ("Enter the personal code OCCaP-helper sent to your IISc
email"). Do not put the batch link in this mail: the link is shared in the batch group, and the code mail stays
personal.

## 3. Send a test to yourself first

1. **Edit Recipient List**, **Filter**: field `email`, *Equal to*, your own address. **OK**.
2. **Finish & Merge**, **Send Email Messages**: *To* `email`, *Subject line* as above, *Mail format* **Plain text**,
   *Send records* **All**. **OK**.
3. Check the mail in your inbox, then use that code in My status (it is also your own check that the Azure
   `CODE_SECRET` matches your `.code-secret`).

## 4. Send to everyone

1. **Edit Recipient List**, **Filter**, **Clear All**. **OK**.
2. **Finish & Merge**, **Send Email Messages**, the same settings, **All**. **OK**.
3. Keep Outlook open until its Outbox is empty. Exchange Online sends about 30 messages a minute, so a few hundred
   mails take a while; that is normal.
4. Delete `codes.csv`.

## Later

- **Resend one code:** run `node tools/status.mjs --codes` again (the codes are the same), filter the recipient list
  to that address as in step 3, and send. Or copy that row's code into a normal reply.
- **New students on a list:** after a refresh adds new addresses, run `--codes` again and send only to the new
  addresses (untick the others in **Edit Recipient List**).
- **The code secret may have leaked:** rotate it (see `tools/STATUS_SETUP.md`); every code changes, so mail
  everyone again.
