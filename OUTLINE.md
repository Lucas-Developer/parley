#How Parley Works

Parley is primarily trying to solve the chicken-and-egg network effect which has plagued PGP-encrypted email since its inception. PGP works really well, and for all the clucking hens running around these days saying that email is broken there are millions of people who disagree. The problem, then, is that existing PGP users don't know anyone else using PGP: that's what we're trying to fix, by making a PGP email client that's easy enough for anyone to use, and secure enough that existing PGP users will be comfortable recommending it to their friends. We're trying to solve other problems, too, because they are attached to that problem: secure and convenient key management, a monetisation scheme that is both accessible to everyone and doesn't rely on advertising, and all of the UX challenges that come with simplifying public key encryption for a wide audience (not to mention the UX challenges related to email itself).

We still have a long way to go, but this document aims to describe Parley's core, underlying security model, which has already been implemented in the beta and it extremely unlikely to change.

First, though, a few general notes:

- We're not cryptographers, and we didn't invent any wild new encryption techniques. Emails are sent using PGP, everything is transferred over SSL/TLS, passwords are hashed with PBKDF2, API authentication is done using SHA-256 HMAC, and we use AES 256 once.
- All of our code is open sourced, available at [github.com/blackchair/parley](https://github.com/blackchair/parley).
- Parley is built around two important compromises. Namely:
	- Keyrings need to be stored on the server, because our target users are the sort who don't want to deal with them manually (via USB drives or whatnot). They're encrypted before they ever reach the server, and quite resilient to bruteforce attacks, but it's a major compromise nonetheless.
	- We, the Parley creators and administrators, are not interested in fighting law enforcement over your data. We've designed the system so that we couldn't decrypt your data even if we wanted to, and it would be difficult to distribute a malicious client (because everything is open sourced and updates are not automatic) but we intend to comply with law enforcement agencies when asked. This is actually a pretty minor compromise in our books--the whole point of Parley is that even if our server gets rooted entirely it would be exceptionally difficult to crack even a single user's keys.

In light of those compromises, anyone who is actively evading government surveillance should continue managing their own keys. They may want to consider inviting their friends to use Parley, though!


With those notes out of the way, it's pretty obvious that the main difference between Parley and any other PGP client is that we've hidden key management from the user entirely. In fact, at this point that is the only difference. Here's how we do it:

1. A user creates a new Parley account by registering their email address via the Parley website
2. A verification link is sent to the user's email address.
3. The user downloads the Parley client. All further interaction with Parley is done via the client.
4. The user enters their email address, at which point they are prompted to complete the registration process (name, password, etc.)
5. The password is PBKDF2 hashed, twice, with a user-specific salt. The first round of hashing forms the "local password", which is used as the passphrase for the user's secret key. The second round of hashing forms the "remote password", which acts as an API secret. Doing it this way ensures that the server never sees any passwords actually related to encryption, but only strongly hashed versions of them. Using the "local password" simply prevents us from passing around the user's plaintext password in memory, which is a comparatively small comfort but it at least protects the plaintext version from being sniffed out by a client-side attacker (in case the plaintext pasword is used elsewhere).
6. The keypair is generated.
7. An ASCII armored version of the keypair (including the passphrase-protected secret key) is AES 256 encrypted (using the "local password") and sent to the server, along with the API key ("remote password"). Subsequent communications with the server will authenticate against that API key using a SHA-256 HMAC signature.
8. On the client, any PGP operations requiring the secret key are carried out using the local password. (The desktop versions of Parley interact with a local installation of GPG to do the heavy lifting. Future mobile versions will need to use libraries corresponding to the respective platforms.)
9. On subsequent logins, the local and remote passwords are regenerated based on the user's plaintext password, and the remote password is authenticated against the API. If successful, the user is granted access to their encrypted keyring for retrieval--it can be downloaded and decrypted using the local password if the client deems it necessary. (Currently we just download every time; in the future we may choose to use a local version of the keyring when available and lazy-load the server's version behind the scenes for updates...)
10. That's it!

So there's no magic, and the whole system is relatively simple. We still have a lot of work to do in verifying our implementation of the plan discussed here, and that will include an audit by a reputable firm, but we're confident that the design is at least conceptually sound.
