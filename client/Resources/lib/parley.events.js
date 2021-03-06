(function(Parley, $, undefined){
    Parley.vent = Parley.vent || _.extend({}, Backbone.Events);

    /**
    Builds Parley.contacts from the current user's keychain.

    @event contact:sync
    **/
    Parley.vent.on('contact:sync', function () {
        console.log('Populating contacts from keychain');
        for (var keychain=[], i=0, list=Parley.listKeys(), max=list.length; i<max; i++) {
            keychain.push(list[i]);
        }
        Parley.contacts.set(keychain, {parse:true});
    });

    /**
    Gets as much info about a contact as possible. This can take an email or fingerprint, with which it searches:

        a) Parley servers for an existing user, or; (if no user is found)
        b) public PGP key servers

    This will return as much information as it can find.

    @method getUserInfo
    @param {Object|String} contact Either an email string or an object containing at least one of _email_ or _fingerprint_ as properties.
    @param {Function} callback
    @return null
    **/
    Parley.getUserInfo = function (contact, callback) {
        callback = callback || function () {};

        if (typeof contact == 'string') {
            var email = contact;

            // Instantiated without arguments so as not to trigger a certain event
            contact = new Parley.Contact;

            contact.set({email:email});
        } else {
            var email = contact.get('email') || Parley.parseUID(contact.get('uids')[0]).email,
                fingerprint = contact.get('fingerprint');
        }

        var planA = function(data) {
            console.log("A");
            if (!data.public_key) {
                planB();
            } else {
                var key = Parley.importKey(data.public_key);
                var fingerprint = key.fingerprints[0];
                contact.set( _.extend(data, Parley.AFIS(fingerprint)) );
                callback(contact);
            }
        }
        var planB = function(data, textStatus) {
            console.log("B");
            if (!email && !fingerprint)
                callback({error: 'User not found'});

            fingerprint = fingerprint || Parley.requestPublicKey(email);
            var userinfo = Parley.AFIS(fingerprint) || contact.attributes;
            userinfo = _.isArray(userinfo) ? userinfo[0] : userinfo;

            if (userinfo && !userinfo.uids) {
                callback({error: 'User not found'});
            } else {
                var parsed = Parley.parseUID(userinfo.uids[0]);
                userinfo.name = parsed.name;
                userinfo.email = parsed.email;
                contact.set(userinfo);
                callback(contact);
            }
        }

        if (email) {
            return Parley.requestUser(email).success(planA).error(planB);
        } else {
            return planB();
        }
    }

    /**
    Gets info on a particular contact.

    @event contact:userinfo
    @param {Object} contact The contact on whom to get information.
    @param {Function} callback
    **/
    Parley.vent.on('contact:userinfo', function (data) {
        console.log('VENT: contact:userinfo');
        console.log('Checking user: ' + JSON.stringify(data.contact));

        contact = Parley.getUserInfo(data.contact, data.callback);
    });

    Parley.vent.on('contact:fetch', function (callback) {
        console.log('contact:fetch');

        Parley.requestContacts(function (data) {
            if (data && !data.error) {
                callback(data);
            } else {
                console.log(JSON.stringify(data));
            }
        });
    });

    /**
    Verify the email that the user submitted.

    This is the first event that gets triggered to begin the login/registration flow. 
    **/
    Parley.vent.on('setup:verify', function (formdata) {
        console.log('Verifying email address: ' + formdata.email);

        Parley.requestUser(formdata.email, function (data, textStatus) {
            if (data && !data.error) {
                console.log('User exists, setting up login form.');
                Parley.dialog('setup login', {
                    email: formdata.email
                });
            } else {
                console.log('User doesn\'t exists, showing registration form.');
                Parley.dialog('setup register', {
                    email: formdata.email
                });
            }
        });
    });

    Parley.vent.on('setup:register', function (formdata) {
        console.log('About to register user: ' + formdata.email);

        Parley.dialog('show info register-wait', { header: _t('registering'), message: _t('message-register-wait') });

        Parley.registerUser(formdata.name, formdata.email, formdata.password, formdata.send_key, function (data, textStatus, jqXHR) {
            console.log(JSON.stringify(data), textStatus, data.error);

            if (data && !data.error) {
                console.log('New user successfully registered with email: ' + Parley.currentUser.get('email'));
                console.log('Registering new inbox with Context.io');

                Parley.registerInbox();
                Parley.waitForRegisteredInbox(function(success) {
                    Parley.dialog('hide info inbox-error');
                    _.delay(function(){ Parley.vent.trigger('message:sync'); }, 5000);

                    Parley.fetchAndDisplayContacts();
                });

                Parley.dialog('hide setup');
                Parley.dialog('hide info register-wait');

                Parley.app.render();
            } else {
                Parley.dialog('hide info register-wait');
                Parley.dialog('info register-error', {
                    header: 'Error',
                    message: _t('error-register'),
                    buttons: [ 'okay' ]
                });
                console.log('Error registering');
                console.log(textStatus);
            }
        });
    });

    Parley.fetchAndDisplayContacts = function () {
        Parley.vent.trigger('contact:fetch', function (data) {
            var contact, areMembers, pendingList = new Parley.ContactList;

            console.log('Contacts fetched');

            _(data.contacts).each(function (ele) {
                if (contact = Parley.contacts.findWhere({email:ele.email})) {
                    areMembers = (areMembers || 0) + 1;
                    pendingList.unshift(contact);
                } else {
                    ele.pending = true;
                    contact = new Parley.Contact(ele);
                    pendingList.push(contact);
                    Parley.contacts.push(contact);
                }
            });

            Parley.dialog('show invite', {
                areMembers: areMembers,
                contacts: pendingList.toJSON()
            });
        });
    }

    Parley.vent.on('setup:login', function (formdata) {
        console.log('VENT: setup:login');
        Parley.dialog('info login-wait', { header: _t('logging in'), message: _t('message-login-wait') });

        Parley.authenticateUser(formdata.email, formdata.password, function (data, textStatus) {
            if (data && !data.error) {
                console.log('User successfully logged in.');

                var parsed_data = Parley.falseIsFalse(data);

                Parley.currentUser.set(parsed_data);

                Parley.vent.trigger('contact:sync');
                Parley.vent.trigger('message:sync');

                Parley.dialog('hide setup');
                Parley.dialog('hide info login-wait');

                Parley.app.render();
            } else {
                console.log('Login error occurred');

                Parley.dialog('hide info login-wait');
                Parley.dialog('info login-error', {
                    header: _t('error logging in'),
                    message: _t('error-login'),
                    buttons: ['okay']
                });
            }
        }, formdata.remember);
    });

    Parley.vent.on('message:sync', _.throttle(function () {
        console.log('VENT: message:sync');

        if (!Parley.currentUser)
            return false;

        $('#refreshAction').attr('disabled', 'disabled').addClass('refreshing').animate({width:300,height:200,opacity:.5}).text( _t('loading inbox') );

        var fetchedInboxHandler = function (data, textStatus) {
            if (!Parley.currentUser)
                return false;

            console.log('Inbox requested at offset: ' + Parley.inboxCurOffset + '.');

            if (data && !data.error) {
                if (textStatus != 'localStorage') Parley.inboxCurOffset += 100;

                Parley.inbox = Parley.inbox || new MessageList;
                if (data.messages) {
                    console.log('Inbox: loaded ' + data.messages.length + ' messages.', data.messages);
                    for (var i = 0, t = data.messages.length; i<t; i++) {
                        Parley.inbox.add(data.messages[i], {parse:true});
                    }

                    if (Parley.inbox.length < (Parley.inboxCurPage * Parley.inboxPerPage))
                        Parley.vent.trigger('message:sync');
                    else
                        $('#refreshAction')
                            .removeAttr('disabled')
                            .removeClass('refreshing')
                            .animate({
                                width:200,
                                height:50,
                                opacity:1
                            })
                            .text( _t('refresh inbox') );
                } else {
                    console.log('End of mailbox');
                }
            } else if (data.error == "FORBIDDEN") {
                console.log('error, forbidden inbox');

                Parley.dialog('info inbox-error', {
                    message: _t('error-inbox-forbidden'),
                    buttons: [ {
                        id: 'reconnectInbox',
                        text: _t('reconnect inbox'),
                        handler: function (e) {
                            e.preventDefault();
                            
                            Parley.registerInbox();
                            Parley.waitForRegisteredInbox(function(success) {
                                Parley.dialog('hide info inbox-error');
                                _.delay(function(){Parley.vent.trigger('message:sync');},1000);
                            });
                        }
                    } ]
                });

                return false;
            } else {
                console.log(data);
                // An error occurred
            }
        };
        var lsInbox = Parley.requestInbox(Parley.inboxCurOffset, fetchedInboxHandler);
        //if (Parley.inbox.length == 0 && lsInbox.length > 0) fetchedInboxHandler({'messages':lsInbox});
        if (Parley.inbox.length == 0 && lsInbox.length > 0) fetchedInboxHandler({'messages':lsInbox}, 'localStorage');
    }, 5000));

    Parley.vent.on('message:nokey', function (data, callback) {
        console.log('Unknown emails in recipients list');

        var message = data.message,
            nokeys = data.nokeys,
            recipient;

        var nokeysBuilder = _(nokeys).map(function (ele, key) {
            var dfd = $.Deferred();

            Parley.getUserInfo(ele.email, function (recipient) {
                if (!recipient.error) {
                    message.recipients.push(recipient);
                    delete nokeys[key];
                }
                dfd.resolve();
            });

            return dfd.promise();
        });

        $.when.apply($, nokeysBuilder).then(function () {
            if (!_.isEmpty(nokeys)) {
                // Couldn't find public key, open invite dialog
                var nokeysHTML = _(nokeys).reduce(function (memo, val) {
                    return memo + '<li>' + val.email + '</li>';
                }, '<ul>') + '</ul>';
                Parley.dialog('show info nokey', {
                    message: _t('message-nokey'),
                    extra_html: nokeysHTML,
                    buttons: [ 
                        {
                            id: 'inviteDialogAction',
                            text: _t('invite'),
                            handler: function (e) {
                                e.preventDefault();
                                Parley.dialog('invite', { emails: nokeys });
                                Parley.dialog('hide info nokey');
                            }
                        },
                        'cancel'
                    ]
                });
            }
            if (!_.isEmpty(message.recipients)) Parley.vent.trigger('message:send', message, callback);
        }, function () {
            // This gets called if getUserInfo doesn't have a chance to fire the callback
            if (!_.isEmpty(nokeys)) {
                // Couldn't find public key, open invite dialog
                var nokeysHTML = _(nokeys).reduce(function (memo, val) {
                    return memo + '<li>' + val.email + '</li>';
                }, '<ul>') + '</ul><br>';
                Parley.dialog('show info nokey', {
                    message: _t('message-nokey'),
                    extra_html: nokeysHTML,
                    buttons: [ 
                        {
                            id: 'inviteDialogAction',
                            text: _t('invite'),
                            handler: function (e) {
                                e.preventDefault();
                                Parley.dialog('invite', { emails: nokeys });
                                Parley.dialog('hide info nokey');
                            }
                        },
                        'cancel'
                    ]
                });
            }
        });
    });

    Parley.vent.on('message:send', function (message, callback) {
        console.log('Sending email to: ' + JSON.stringify( message ));
        Parley.dialog('info send-message', { message: _t('message-message-sending') })

        Parley.encryptAndSend(message.subject, message.body, message.recipients, function (data, textStatus) {
            if (data && !data.error) {
                console.log('Message successfully sent.');
                console.log( JSON.stringify(data) );
                Parley.dialog('hide compose');
                Parley.dialog('hide info send-message');
                Parley.dialog('info sent-message', {
                    message: _t('message-message-sent'),
                    buttons: [ 'okay' ]
                });
            } else {
                console.log('Message not sent.');
                Parley.dialog('info sent-message', {
                    message: _t('error-message-notsent'),
                    buttons: [ 'okay' ]
                });
                return false;
            }
        });
    });

    Parley.vent.on('user:kill', function (callback) {
        console.log('VENT: user:kill');
        callback = callback || function () {};

        Parley.dialog('show info revoke-confirm', {
            message: _t('message-key-revokeconfirm'),
            buttons: [ {
                id: 'confirmRevokeKeyAction',
                text: _t('confirm'),
                handler: function () {
                    Parley.killUser(function (data, status) {
                        Parley.dialog('hide info revoke-confirm');
                        if (!data.error) {
                            // **TODO: Should destroy records from local storage too.

                            Parley.app.quit();
                        } else {
                            Parley.dialog('show info revoke-info', {
                                message: _t('message-key-revokeerror'),
                                buttons: [ 'okay' ]
                            });
                        }
                    });
                }
            }, 'cancel' ]
        });
    });

    Parley.vent.on('invite', function (emails, callback) {
        console.log('VENT: invite');
        callback = callback || function () {};

        if (_.isString(emails))
            emails = [emails];
        else if (!_.isArray(emails))
            return false;

        var inviteBuilder = _(emails).map(function (ele, key) {
            var dfd = $.Deferred();

            Parley.invite(ele, function (recipient) {
                if (!recipient.error)
                    dfd.resolve();
            });

            return dfd.promise();
        });

        $.when.apply($, inviteBuilder).then(function () {
            callback();
        });
    });
}(window.Parley = window.Parley || {}, jQuery));
