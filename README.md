# 1939 Gym Bros

A simple, phone-friendly gym tracker for a group. Static HTML/JS (no build step) and Supabase for storage.

## Setup

### 1. Supabase
1. Create a free project at https://supabase.com.
2. **Authentication → Users → Add user → Create new user** (not "Send invitation"): enter an email
   (any, e.g. your own) and the **group password**, and **tick "Auto Confirm User"**.
   No email is sent and none is needed: the app logs in with the password directly.
3. **SQL Editor → New query**: paste the contents of `schema.sql`, replace `YOUR@EMAIL` (twice) with
   the email from step 2, and click **Run**. Only that account can change data.
4. Optional: **Authentication → Sign In / Providers → User Signups**: turn off "Allow new users to sign up".
5. **Project Settings → API** (or the **Connect** button): copy the Project URL and the anon / publishable key.

### 2. Config
Edit `config.js`: fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `GROUP_EMAIL` (the email from step 4).
The anon key is meant to be public, so it's fine to commit it.

### 3. Run locally (optional)
```
npx serve .
```
or `python -m http.server`, then open the printed address.

### 4. Publish on GitHub Pages
1. Create a GitHub repo and push these files to it.
2. Repo **Settings → Pages**: Source "Deploy from a branch", branch `main`, folder `/ (root)`.
3. After a minute the app is live at `https://<user>.github.io/<repo>/`.
   On a phone, use "Add to Home Screen" to get it like an app.

## How it works
- Anyone with the link can **view**. Saving needs the group password, entered once per phone (tap **Unlock**).
- **Members**: add your group first. Removing a member hides them from new workouts but keeps their history.
- **Workout**: Start workout → Add exercise → pick an existing one or type a new name.
  Each member gets a card showing **last time** they did that exercise, with sets of reps + kg.
  Tap **Not here** for anyone missing, then **Finish exercise** to save.
- Unsaved input is kept on the phone, so an accidental reload doesn't lose it.
- Past workouts are listed on the home screen; tap one to see the overview or edit it.
