parley
======
The [Parley](https://parley.co) client and server code lives here.

View the source of this document [here](https://github.com/blackchair/parley/raw/master/README.md)

Purpose
-------
Parley is an email service that is intended to make secure email communications more accessible to end-users without requiring a technical background. 

The Parley client interoperates with existing end-to-end encrypted email systems, and aims to provide a level of security that is virtually unbreakable (nobody, not even the NSA, should be able to read mail that is sent by the Parley client).

The Parley server code provides account and key management for calls made by the parley server.

Getting Started
---------------
When the client runs for the first time, it will most likely require that some software dependancies be installed. This software is called [Gnu Privacy Guard](http://en.wikipedia.org/wiki/GNU_Privacy_Guard) or GPG for short and is used for cryptographic functions such as generating keys and decrypting/encrypting messages. It is based on [PGP](http://en.wikipedia.org/wiki/Pretty_Good_Privacy). For more information see the [Overview of the Cryptosystem](#overview-of-the-cryptosystem). This process will sometimes make the system appear to hang.

Once GPG is installed, you can provide an email address that is registered with the parley server (see http://parley.co) to get started. You will also be asked for a password to be used by the Parley service as well as the name that should appear on your messages.

~~If you have used a keyserver before to manage your identity with other PGP-based services, you can import that key to use it with Parley as well. Otherwise, generate a new key to continue. This process also takes a moment.~~

_Until we deal with a few issues relating to the way the keys get shared between Parley and public PGP key servers (see [Issue #31](https://github.com/blackchair/parley/issues/31)), we don't allow you to import your own key. In the meantime, we have an option to select whether you want your Parley key to be distributed to public PGP key servers or not. By default, we will **not** send it, so as not to interfere with your extant public key._

At this point, your inbox will be loaded. The previous steps for registration and key generation will not be required for subsequent logins

Overview of the Cryptosystem
----------------------------
Parley utilizes the same underlying architecture as PGP to provide confidentiality and integrity for messages sent using the client. You can read more about it [here](http://en.wikipedia.org/wiki/Pretty_Good_Privacy).
