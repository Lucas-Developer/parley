(function(Parley, $, undefined){
    /*
    These first two statements could be moved, but I put them here for now.
    */
    $.fn.serializeObject = function() {
        var o = {};
        var a = this.serializeArray();
        $.each(a, function() {
            if (o[this.name] !== undefined) {
                if (!o[this.name].push) {
                    o[this.name] = [o[this.name]];
                }
                o[this.name].push(this.value || '');
            } else {
                o[this.name] = this.value || '';
            }
        });
        return o;
    };
	WebFont.load({
	    google: {
		families: ['Source Sans Pro', 'PT Sans', 'PT Serif']
	    }
	});

    Parley.i18n = Backbone.Model.extend({
        defaults: function () {
            return {
                lang: 'en'
            }
        },
        dict_files: {
            // Make sure the actual files are '.json'
            en: 'dict.en',
            fr: 'dict.fr'
        },
        dict_path: 'lang/',
        initialize: function (l,p) {
            // Freeze up the app for the split second it takes to load
            // the first language files
            this.loadDictionary({lang:'en',sync:true});
        },
        loadDictionary: function (opts) {
            var lang = opts.lang || Parley.currentUser && Parley.currentUser.get('lang') || 'en';
            var path = opts.path || this.dict_path + this.dict_files[lang] || dict_path + 'dict.en';
            var model = this;

            $.ajax({
                type: 'GET',
                async: !opts.sync,
                url: path + '.json',
                success: function (dict) {
                    $.i18n.setDictionary(dict);
                },
                dataType: 'json'
            });
        },
        _t: function (message) {
            return $.i18n._(message);
        }
    });

    /** This should be moved to a new file or something
        it's basically a bunch of events. EVENTually I think
        all of the events can go through this in some way.
    **/
    Parley.vent = _.extend({}, Backbone.Events);

    Parley.vent.on('contact:userinfo', function (contact) {
        console.log('VENT: contact:userinfo');

        // Gotta have either an email or a fingerprint.
        // Will just fail silently if it gets neither
        var email = contact.get('email');
        
        var planA = function(userinfo) {
            if (!_(userinfo).has('public_key')) {
                planB();
            } else {
                var key = Parley.importKey(userinfo.public_key);
                var fingerprint = key.fingerprints[0];
                contact.set( _.extend(userinfo, Parley.AFIS(fingerprint)) );
                if (Parley.currentUser.get('email') != email) Parley.contacts.add(contact);
            }
        }
        var planB = function() {
            var fingerprint = Parley.requestPublicKey(email) || contact.get('fingerprint');
            var userinfo = Parley.AFIS(fingerprint);

            userinfo = _.isArray(userinfo) ? userinfo[0] : userinfo;

            if (!_(userinfo).has('uids')) {

            } else {
                var parsed = Parley.parseUID(userinfo.uids[0]);
                userinfo.name = parsed.name;
                userinfo.email = parsed.email;
                contact.set(userinfo);
                if (Parley.currentUser.get('email') != email) Parley.contacts.add(contact);
            }
        }
        Parley.requestUser(email, function(){}).success(planA).error(planB);
    });

    Parley.vent.on('setup:verify', function (e) {
        e.preventDefault();
        var form = document.forms.emailVerify;
        if (_.isUndefined(form.email.value)) return false;
        console.log('Verifying email address: ' + form.email.value);

        Parley.requestUser(form.email.value, function (data, textStatus) {
            if (_.isObject(data) && !_.has(data, 'error')) {
                console.log('User exists, setting up login form.');
                Parley.app.dialog('setup login', {email: form.email.value});
            } else {
                console.log('User doesn\'t exists, showing registration form.');
                Parley.app.dialog('setup register', {email: form.email.value});
            }
        });
    });
    Parley.vent.on('setup:register', function (e) {
        e.preventDefault();
        var form = document.forms.registerAction;
        if (form.password_one.value != form.password_two.value) {
            // Passwords don't match
            console.log('Passwords don\'t match.');
        } else {
            console.log('About to register user: ' + form.email.value);
            Parley.app.dialog('loading', { message: Parley.app.i18n._t('register-wait') });

            Parley.registerUser(form.name.value, form.email.value, form.password_two.value, function (data, textStatus) {
                console.log(JSON.stringify(data), textStatus, data.error);

                console.log('New user successfully registered with email: ' + Parley.currentUser.get('email'));
                console.log('Registering new inbox with Context.io');
                
                Parley.registerInbox();

                Parley.app.loadUser();
                Parley.app.dialog('hide');
            });
        }
    });
    Parley.vent.on('setup:login', function (e) {
        e.preventDefault();
        var form = document.forms.loginAction;

        Parley.app.dialog('loading', { message: Parley.app.i18n._t('login-wait') });

        Parley.authenticateUser(form.email.value, form.password.value, function (data, textStatus) {
            console.log('User successfully logged in.');
            Parley.app.loadUser();
            Parley.app.dialog('hide');
        });
    });
/*
	    logout: function () {
			console.log('Logging out');
			Parley.currentUser.destroy();
            Parley.app.render();
	    },
*/
    Parley.vent.on('message:send', function (e) {
        e.preventDefault();

        var formdata = $('#composeForm').serializeObject();

        var recipients = [], nokeyRecipients = [];
        //var recFields = ['as_values_to', 'as_values_cc', 'as_values_bcc'];
        var recFields = ['as_values_to'];
        // This can be done more efficiently, probably
        _.each(recFields, function (fName) {
            if (!_.isEmpty(formdata[fName])) {
                _.each(formdata[fName].split(','), function (ele, i) {
                    var recipient = Parley.contacts.findWhere({email:ele});
                    if (recipient)
                        recipients.push(recipient);
                    else if (!_.isEmpty(ele))
                        nokeyRecipients.push({email:ele});
                });
            }
        });

        console.log('Sending email to: ', recipients);
        
        if (nokeyRecipients.length > 0) {
            console.log('We have no keys for these recipients: ', nokeyRecipients);
            Parley.app.dialog('setup nokey', {emails:nokeyRecipients});
        } else { }

        if (!_.isEmpty(recipients)) Parley.encryptAndSend(formdata.subject, formdata.body, recipients, function (data, status, jqXHR) {
            console.log( JSON.stringify(data) );
        });
    });

/*
        inviteAction: function (e) {
            var email,selected = this.$('.selector a.clicked').parent();
            selected.each(function (i,e) {
                var $e = $(e);
                email = $e.find('.email').text();
                Parley.invite(email, function () {});
            });
        },
        retryInbox: function (e) {
            Parley.app.loadUser();
        },
        newContact: function () {
            this.setPage('newcontact');
        },
        addContact: function (e) {
            e.preventDefault();

            // Form validation should go here
            var formdata = $(document.forms.newcontact).serializeObject();
            var newContact = new Parley.Contact(formdata);
            //Parley.vent.trigger('contact:userinfo', newContact);
            this.setDialog('loading', {message:'saving-contacts'});

            Parley.storeKeyring(_.bind(function(){
                this.setDialog('contacts');
            }, this));
        }
*/
    /** END VENT CODE **/

	Parley.BaseView = Backbone.View.extend({
		assign: function (view, selector) {
			view.setElement(this.$(selector)).render();
		}
	});

	Parley.Contact = Backbone.Model.extend({
	    defaults: function () {
			return {
				last_received: 0,
				last_sent: 0,
				thumbnail: false,
				count: 0,
                messages: []
			}
	    },
        initialize: function (attrs) {
            console.log('Initializing contact.');

            Parley.vent.trigger('contact:userinfo', this);
        },
        addMessage: function (message) {
            message = message.toJSON ? message.toJSON() : message;
            this.set({
                last_received: this.attributes.last_received + 1,
                count: this.attributes.count + 1
            });
            this.get('messages').push(message);

            return this;
        }
	});

	var ContactList = Backbone.Collection.extend({
	    model: Parley.Contact
	});
	var ContactView = Parley.BaseView.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#contactTemplate').html()),
	    events: {
            "click .send" :     "sendMessage"
        },
		render: function () {
			var data = this.model.toJSON();

            this.listenTo(this.model, 'change', this.render);

			this.$el.addClass('contact').html(this.template(data));
			return this;
	    },
        sendMessage: function () {
            Parley.app.dialog('compose', {from:this.model});
        }
	});

	Parley.Message = Backbone.Model.extend({
        defaults: function () {
            return {
                from: {},
                subject: '',
                selected: false
            };
        },
        initialize: function () {
            var data = this.toJSON();
            var from = data.addresses.from;
            var from_obj = Parley.contacts.findWhere({email: from.email});

            if (!from_obj) {
                console.log('Creating contact from scratch.');

                from_obj = new Parley.Contact(from);
            }

            if (_.has(data.person_info, from.email)) from_obj.set('thumbnail', data.person_info[from.email].thumbnail);

            this.set('from', from_obj.addMessage(this));

            // If it's not encrypted, we can just populate the decrypted message array
            this.decryptedMessage = this.decryptedMessage || [];
            _.each(data.body, function (v,k) {
                if (v.type == 'text/plain' && !!~v.content.indexOf('-----BEGIN PGP MESSAGE-----'))
                    this.decryptedMessage.push(v.content);
            }, this);
        },
        readMessage: function () {
            if (this.decryptedMessage.length > 0) {
                console.log('Reading message from memory.');
                return this.decryptedMessage;
            } else {
                // This needs some error handling, must be bird-ass tight
                console.log('Decrypting message.');
                var sender = this.getSender();
                this.decryptedMessage = this.decryptedMessage || [];
                _.each(this.get('body'), _.bind(function (v,k) {
                    this.decryptedMessage.push(Parley.decryptAndVerify(v.content, this.getSender()));
                }, this));
                return this.decryptedMessage;
            }
        },
        toggleSelect: function () {
            this.set({'selected': !this.get('selected')});
            return this.get('selected');
        }
	});

	var MessageList = Backbone.Collection.extend({
	    model: Parley.Message
	});
	var MessageView = Parley.BaseView.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#messageTemplate').html()),
	    events: {
            'click .from':          'openContact',
			'click .subject':		'openMessage',
            'click .selector':      'toggleSelect'
	    },
	    initialize: function (options) {
			this.listenTo(this.model, 'add', this.render);

			this.listenTo(this.model, 'change', this.render);
			this.listenTo(this.model, 'destroy', this.remove);
	    },
	    render: function () {
			this.$el.addClass('message').html(this.template(this.model.toJSON()));
			return this;
	    },

        openContact: function () {
            Parley.app.dialog('contacts', {single: this.model.get('from').toJSON()});
        },
	    openMessage: function () {
            Parley.readMessageView = new ReadMessageView({model:this.model});

            this.$el.after(Parley.readMessageView.render().el);
	    },
        toggleSelect: function () {
            this.model.toggleSelect();
        },
	});

    var ReadMessageView = Parley.BaseView.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#readMessageTemplate').html()),
	    events: {
            'click .reply':     'openCompose'
	    },
	    render: function () {
            var message_body = _.reduce(this.model.readMessage(), function (memo, val) {
                return memo + '<p>' + val.replace('\\n', '<br>') + '</p>';
            }, '');
            
			this.$el.addClass('message-body').html(this.template({body:message_body}));
			return this;
	    },

        openCompose: function () {
            Parley.app.dialog('compose', this.model.toJSON());
        }
    });

	var User = Parley.Contact.extend({
	    defaults: function () {
			return { registered: false };
	    },
	    initialize: function () {
	    }
	});

    var HeaderView = Parley.BaseView.extend({
        el: $('header'),
	    template: Mustache.compile($('#headerTemplate').html()),

        events: {
            'click #composeAction': function (e) {
                console.log('Composing new message.');
                Parley.app.dialog('compose');
            },
            'click #replyAction': function (e) {
                var sel = Parley.inbox.findWhere({selected:true});
                console.log('Replying to: ', sel);

                Parley.app.dialog('compose', reply_to.toJSON());
            },
            'click #forwardAction': function (e) {
                var sel = Parley.inbox.findWhere({selected:true});
                console.log('Forwarding: ', sel);
            },
            'click #deleteAction': function (e) {
                var sel = Parley.inbox.where({selected:true});
                console.log('Deleting: ', sel);

                Parley.vent.trigger('message:delete', sel);
            },
            'click #maliceAction': function (e) {
                console.log('Malice detected in: ', Parley.inbox.where({selected:true}));
            }
        },

        render: function () {
            this.$el.html(this.template());

            return this;
        }
    });

    var DialogView = Parley.BaseView.extend({
        el: $('#dialogWrapper'),

        /**
        This will be handled through the fancy vent
        but for now, it's like this...
        **/
        events: {
			'click #logoutAction':		'logout',
            'click #inviteAction':      'inviteAction',
            'click #retryInbox':        'retryInbox',
            'keydown': 'clickSubmit'
        },

        initialize: function (options) {
            this.$el.dialog({autoOpen:false});

            /*
            Now, there is certainly a better way to do this but here's how I do it.
            For values that need to be recalculated every render, add init()
            in an object below and do what you need, secure in the knowledge that it
            will be invoked immediately before rendering.
            */
            this.dialogs = new Backbone.Collection([
                {   slug: 'loading',
                    template: Mustache.compile($('#loadingDialogTemplate').html()),
                    opts: { width: 600, position: ['center', 80], dialogClass: 'no-close', draggable: false },
                    title: 'Loading'
                },
                {   slug: 'setup',
                    template: Mustache.compile($('#setupDialogTemplate').html()),
                    opts: { width: 600, position: ['center', 80], dialogClass: 'no-no-close', draggable: false },
                    title: 'Welcome to Parley',
                    loaded: function (view) {
                        view.$('#text_message')._t('welcome');
                    },
                    events: {
                        'click #emailVerify': function (e) { Parley.vent.trigger('setup:verify', e); },
                        'click #loginAction': function (e) { Parley.vent.trigger('setup:login', e); },
                        'click #registerAction': function (e) { Parley.vent.trigger('setup:register', e); },
                        'keydown': 'clickSubmit'
                    }
                },
                {   slug: 'settings',
                    template: Mustache.compile($('#settingsDialogTemplate').html()),
                    opts: { resizable: false, width: 550 },
                    title: 'Parley Settings',
                    init: function () {
                        _.extend(this, Parley.currentUser.toJSON());
                    }
                },
                {   slug: 'contacts',
                    template: Mustache.compile($('#contactsDialogTemplate').html()),
                    opts: { minWidth: 600, maxWidth: 1000 },
                    title: 'Contacts',
                    init: function () {
                        this.contacts = Parley.contacts.toJSON();
                    },
                    loaded: function (view) {
                        view.$('#contactsList').replaceWith(Parley.app.contactsList);
                    },
                    events: {
                        'click #newContact': function (e) {},
                        'click #addContact': function (e) {}
                    }
                },
                {   slug: 'nokey',
                    template: Mustache.compile($('#nokeyDialogTemplate').html()),
                    opts: {},
                    title: 'Public PGP keys not found.'
                },
                {   slug: 'compose',
                    template: Mustache.compile($('#composeDialogTemplate').html()),
                    opts: {},
                    title: 'Compose',
                    init: function () {
                        this.to = _.has(this, 'reply_to') ? this.reply_to.toJSON() : _.has(this, 'from') ? this.from.toJSON() : undefined;
                        if (_.has(this, 'subject')) {
                            var prefix = /^(R|r)e:/g;
                            this.subject = prefix.test(this.subject) ? this.subject : 're: ' + this.subject;
                        }
                    },
                    loaded: function (view) {
                        var items = Parley.contacts.map(function (ele,i) {
                            var email = ele.get('email');
                            var name = ele.get('name') || email;

                            return {name: name, value: email, uid: name + ' <' + email + '>'}
                        });

                        var preFill = _.findWhere(items, {value: this.to.email}) || {};

                        var opts = {
                            selectedItemProp: 'name',
                            searchObjProps: 'name,value',
                            preFill: [preFill]
                        };
                        view.$('#recipients input[type=text]').each(function (){
                            $(this).autoSuggest(items, _.extend({asHtmlID: this.name}, opts));
                        });
                    },
                    events: {
                        'click #sendAction': function (e) { Parley.vent.trigger('message:send', e); }
                    }
                }
            ]);
        },

        render: function () {
            console.log('Rendering dialog box');
            var args = _.isObject(arguments[0]) ? arguments[0] : {};
            var isOpen = this.$el.dialog('isOpen');
            if (isOpen && !this.cur) {
                this.$el.dialog('close');
            } else if (_.isObject(this.cur)) {
                var template = this.cur.get('template');
                var data = this.cur.toJSON();

                data = _.extend(args, data);
                if (_.has(data, 'init'))
                    data.init(this);

                this.$el.dialog(_.extend({
                        autoOpen: true,
                        dialogClass: '',
                        draggable: true,
                        title: this.cur.get('title')
                    }, data.opts));
                this.$el.html(template(data));

                this.delegateEvents(this.cur.get('events'));

                if (_.has(data, 'loaded'))
                    data.loaded(this);
            }
            return this;
        },

        setDialog: function (i, options) {
            if (_.isNumber(i) && (this.cur = this.dialogs.at(i) || undefined)) {
                this.render(options);
                this.setPage();
                return true;
            } else if (_.isString(i) && ( this.cur = this.dialogs.findWhere({slug:i}) || undefined )) {
                this.render(options);
                this.setPage();
                return true;
            } else {
                return false;
            }
        },

        setPage: function (i, options) {
            var cur_page, pages = this.$('.page');
            if (_.isNumber(i) && (cur_page = pages.get(i) || pages.first())) {
                pages.removeClass('page-active');
                cur_page.addClass('page-active');
            } else if (_.isString(i)) {
                cur_page = pages.filter('.page-'+i, i).first();
                if (cur_page.length) {
                    pages.removeClass('page-active');
                    cur_page.addClass('page-active');
                }
            }
            if (pages.filter('.page-active').length == 0) {
                pages.first().addClass('page-active');
            }
            if (_.isObject(options)) {
                for (var val in options) {
                    cur_page.find('[name='+val+']').val(options[val]);
                }
            }
            this.$(':input').first().focus();
        },

        show: function () {
            this.cur = this.cur || this.dialogs.at(0);
            this.render();
        },
        hide: function () {
            this.cur = undefined;
            this.render();
        },

        clickSubmit: function (e) {
            if (e.keyCode == 13) { this.$('input[type=submit],button:visible').click(); }
        }
    });

	var AppView = Parley.BaseView.extend({
	    el: $('body'),

	    events: {
			'click #settingsAction':	'openSettings',
			'click #contactsAction':	'openContacts',
            'click .hidden':            'showHidden'
	    },

        vent: _.extend({}, Backbone.Events),

	    initialize: function () {
			console.log('Initializing Parley.');
            this.i18n = new Parley.i18n;

            this.header = new HeaderView;
            this._dialog = new DialogView;

			this.inbox = $('#inbox tbody');
			this.contactsList = $('<div>');

			this.listenTo(Parley.inbox, 'add', this.addMessage);
			this.listenTo(Parley.contacts, 'add', this.addContact);
            this.listenTo(Parley.inbox, 'change:selected', this.messageSelectedHandler);

			if (!Parley.currentUser) {
		    	console.log('No user logged in. Showing setup dialog.');
                this.dialog('setup');
			}

			this.render();
	    },

	    render: function () {
            console.log('Rendering the app');
           
            this.assign(this.header, 'header');
            return this;
		},

        openSettings: function () {
            this.dialog('settings');
        },
        openContacts: function () {
            this.dialog('contacts');
        },
	    showHidden: function (e) {
            console.log(e.target);
            $(e.target).removeClass('hidden');
        },
        dialog: function (opts,data) {
            if (typeof opts == 'undefined') {
                // With no arguments, returns dialog data as object
                return this._dialog.getJSON();
            } else if (_.isObject(opts)) {
                // Currently does nothing (always pass a string as first arg)
                // Will eventually support passing an object, I'll get to it in a sec
            } else if (_.isString(opts)) {
                var actions = opts.split(' ');
                switch (actions[0]) {
                    case 'hide':
                        this._dialog.hide();
                        break;
                    default:
                        if (this._dialog.setDialog(actions[0], data)) {
                            this._dialog.setPage(actions[1]);
                        }
                        break;
                }
            }
        },

		addContact: function (contact) {
			var view = new ContactView({model: contact});
			this.contactsList.append(view.render().el);
		},

	    addMessage: function (message) {
			var view = new MessageView({model: message});
			this.inbox.append(view.render().el);
	    },

	    loadUser: function () {
			console.log('Setting up main view with logged in user info');
            var opts = {parse:true};

            Parley.vent.trigger('contacts:sync');

/*
            console.log('Populating contacts from keychain');
            for (var keychain=[], i=0, list=Parley.listKeys(), max=list.length; i<max; i++) {
                keychain.push(list[i]);
            }
            Parley.contacts.set(keychain, {parse:true});
*/
            Parley.requestInbox(_.bind(function (data, textStatus) {
                if (data.error == 'FORBIDDEN') {
                    this.dialog('loading', {message: Parley.app.i18n._t('inbox-forbidden'), buttons: [{id:'retryInbox',text:'Retry'},{id:'cancelLoad',text:'Cancel'}]});
                    Parley.registerInbox();
                    return false;
                }

                console.log('Inbox loaded', data.messages);

                Parley.inbox = Parley.inbox || new MessageList({}, opts);
                if (_.has(data, 'messages')) {
                    for (var i = 0, t = data.messages.length; i<t; i++) {
                        Parley.inbox.add(data.messages[i], opts);
                    }
                }

                this.dialog('setup admin');
            }, this));

			this.$el.addClass('loggedin').removeClass('loggedout');
			this.header.$('.email').text(Parley.currentUser.get('email'));

	    },

        messageSelectedHandler: function () {
            var selectedMessages = Parley.inbox.where({selected:true});
            if (selectedMessages.length == 0) {
            } if (selectedMessages.length == 1) {
                this.header.$('#inbox-utilities').removeClass('multi-sel no-sel').addClass('has-sel');
            } else if (selectedMessages.length > 1) {
                this.header.$('#inbox-utilities').removeClass('no-sel has-sel').addClass('multi-sel');
            } else {
                this.header.$('#inbox-utilities').removeClass('multi-sel has-sel').addClass('no-sel');
            }
        }
	});
	
    Parley.inbox = new MessageList;
    Parley.contacts = new ContactList;
	Parley.app = new AppView;

	$('button').button();
}(window.Parley = window.Parley || {}, jQuery));
