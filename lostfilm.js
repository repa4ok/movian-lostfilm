(function(plugin) {
    var PREFIX = plugin.getDescriptor().id;
    var TITLE = plugin.getDescriptor().title;
    var VERSION = plugin.getDescriptor().version;
    var SYNOPSIS = plugin.getDescriptor().synopsis;
    var LOGO = plugin.path + "logo.png";
    var BASE_URL = "http://www.lostfilm.tv/";

    var service = require("showtime/service");
    var http = require("./http");
    var html = require("showtime/html");

    service.create(TITLE, PREFIX + ":start", "video", true, LOGO);

    var authRequired = true;
    var authChecked = false;
    var store = plugin.createStore("config", true);

    var settings = plugin.createSettings(TITLE, LOGO, SYNOPSIS);
    settings.createBool("enableDebug", "Debug output", true, function(v) { store.enableDebug = v });
    settings.createMultiOpt('quality', 'Video quality', [
        ['sd', 'SD'],
        ['hd', 'HD', true],
        ['fhd', 'Full HD']], 
        function(v) {
            printDebug("set quality to " + v);
            store.quality = v;
    });
    settings.createMultiOpt("sorting", "Series sorting", [
        ["desc", "Descending", store.sorting === "desc"],
        ["asc", "Ascending", store.sorting === "asc"]],
        function(v) {
            if (store.sorting != v) {
                printDebug("set sorting to " + v);
                store.sorting = v;
            }
    });
    settings.createDivider("Categories visibility");
    settings.createBool("showPopular", "Popular", true, function(v) { store.showPopular = v; });
    settings.createBool("showNew", "New", true, function(v) { store.showNew = v; });
    settings.createBool("showFilming", "Filming", true, function(v) { store.showFilming = v; });
    settings.createBool("showFinished", "Finished", true, function(v) { store.showFinished = v; });

    function printDebug(message) {
        if (store.enableDebug) console.error(message);
    }

    plugin.search = true;
    plugin.addSearcher(TITLE, LOGO, search)
    plugin.addURI(PREFIX + ":start", start);
    plugin.addURI(PREFIX + ":performCaptchaLogin:(.*):(.*)", performCaptchaLogin);
    plugin.addURI(PREFIX + ":allSerials:(.*):(.*):(.*)", populateAll);
    plugin.addURI(PREFIX + ":serialInfo:(.*):(.*):(.*)", serialInfo);
    plugin.addURI(PREFIX + ":torrent:(.*):(.*)", function (page, serieName, dataCode) {
        page.type = "video";
        page.loading = true;

        if (authRequired) {
            authRequired = performLogin(page) == false;
            if (authRequired) {
                page.loading = false;
                page.error("Login failed. Please go back and try again.");
                return;
            }
        }

        var attributes = dataCode.split('-');
        var c = attributes[0];
        var s = attributes[1];
        var e = attributes[2];
        var response = http.request(BASE_URL + "v_search.php?c=" + c + "&s=" + s + "&e=" + e, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        });

        var torrentsUrl = html.parse(response.toString()).root.getElementByTagName("meta")[0].attributes.getNamedItem("content")["value"].replace("0; url=", "");
        var response = http.request(torrentsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        })

        var foundTorrents = {
            "sd": undefined,
            "hd": undefined,
            "fhd": undefined
        };

        var torrentArr = html.parse(response.toString()).root.getElementByClassName("inner-box--item");
        for (var i = 0; i < torrentArr.length; ++i) {
            var currentTorrent = torrentArr[i];
            var currentTorrentLabel = currentTorrent.getElementByClassName("inner-box--label")[0].textContent.trim().toLowerCase();
            var currentTorrentLink = currentTorrent.getElementByClassName("inner-box--link main")[0].children[0].attributes.getNamedItem("href").value;
            var currentTorrentEpisode = /серия/.test(currentTorrent.getElementByClassName("inner-box--link main")[0].textContent);

            if (currentTorrentLabel == "sd") {
                foundTorrents["sd"] = currentTorrentLink;
            } else if (currentTorrentLabel == "mp4" || currentTorrentLabel == "hd" || currentTorrentLabel == "720") {
                foundTorrents["hd"] = currentTorrentLink;
            } else if (currentTorrentLabel == "fullhd" || currentTorrentLabel == "full hd" || currentTorrentLabel == "1080") {
                foundTorrents["fhd"] = currentTorrentLink;
            }
        }

        var desiredUrl = foundTorrents[store.quality];

        if (desiredUrl == undefined) {
            if (foundTorrents["sd"]) {
                desiredUrl = foundTorrents["sd"];
                printDebug(store.quality + " torrent not found. Playing SD instead...");
            } else if (foundTorrents["hd"]) {
                desiredUrl = foundTorrents["hd"];
                printDebug(store.quality + " torrent not found. Playing HD instead....");
            } else if (foundTorrents["fhd"]) {
                desiredUrl = foundTorrents["fhd"];
                printDebug(store.quality + " torrent not found. Playing Full HD instead....");
            }
        } else {
            printDebug(store.quality + " torrent found. Playing it...");
        }

        if (desiredUrl == undefined || desiredUrl == "") {
            page.error("Failed to find desired torrent.");
            return;
        }
        if (!currentTorrentEpisode) page.redirect(desiredUrl);

        var canonicalUrl = PREFIX + ":torrent:" + serieName + ":" + dataCode;
        page.loading = false;
        page.source = "videoparams:" + showtime.JSONEncode({
            title: serieName,
            canonicalUrl: canonicalUrl,
            sources: [{
                url: 'torrent:video:' + desiredUrl
            }]
        });
    });

    function start(page) {
        page.loading = true;

        page.metadata.logo = LOGO;
        page.metadata.title = TITLE;
        page.type = "directory";
        page.metadata.glwview = plugin.path + "views/main.view";

        var loginField = store.username && store.username.length > 0 ? ("Signed as " + store.username + ". Logout?") : "Sign in";
        page.options.createAction("username", loginField, function() {
            if (store.username) {
                performLogout();
            } else {
                authRequired = performLogin(page) == false;
            }

            page.redirect(PREFIX + ":start");
        });

        checkAuthOnce(page);

        populateMainPage(page);
        page.loading = false;
    }

    function populateMainPage(page) {
        if (authRequired === false) populateSerials(page, "Favorites", 2, 99);
        if (store.showPopular) populateSerials(page, "Popular", 1, 0);
        if (store.showNew) populateSerials(page, "New", 1, 1);
        if (store.showFilming) populateSerials(page, "Filming", 1, 2);
        if (store.showFinished) populateSerials(page, "Finished", 1, 5);
    }

    function populateSerials(page, name, s, t) {
        var serialsList = getSerialList(0, s, t);
        if (serialsList && serialsList.length > 0) {
            page.appendItem("", "separator", {
                title: name
            });

            for (var i = 0; i < serialsList.length; ++i) {
                var serialDescription = getSerialDescription(serialsList[i].id, serialsList[i].link);
                var item = page.appendItem(PREFIX + ":serialInfo:" + serialsList[i].title + ":" + serialsList[i].id + ":" + serialsList[i].link, "directory", {
                    title: serialsList[i].title,
                    icon: "http://static.lostfilm.tv/Images/" + serialsList[i].id + "/Posters/poster.jpg",
                    description: serialDescription,
                    rating: serialsList[i].rating * 10.0
                });
            }

            if (s != 2 || serialsList.length >= 10) {
                page.appendItem(PREFIX + ":allSerials:" + name + ":" + s + ":" + t, "directory", {
                    title: "Show all..."
                });
            }
        }
    }

    function populateAll(page, name, s, t) {
        page.metadata.title = name + " (by rating)";
        page.model.contents = "list";
        page.type = "directory";

        var offset = 0;

        (page.asyncPaginator = function() {
            page.loading = true;
            page.type = "directory";
            page.metadata.glwview = plugin.path + "views/main.view";
            var serials = getSerialList(offset, s, t);

            if (serials.length == 0) {
                page.loading = false;
                page.haveMore(false);
                return;
            } else {
                offset += serials.length;
            }

            for (var i = 0; i < serials.length; ++i) {
                var serialDescription = getSerialDescription(serials[i].id, serials[i].link);
                page.appendItem(PREFIX + ":serialInfo:" + serials[i].title + ":" + serials[i].id + ":" + serials[i].link, "directory", {
                    title: serials[i].title,
                    icon: "http://static.lostfilm.tv/Images/" + serials[i].id + "/Posters/poster.jpg",
                    description: serialDescription,
                    rating: serials[i].rating * 10.0
                });
            }

            page.loading = false;
            page.haveMore(true);
        })();
    }

    function getSerialDescription(serialID, serialUrl) {
        printDebug("getSerialDescription(" + serialID + ", " + serialUrl + ")");

        var checkCache = plugin.cacheGet("SerialsDescriptions", serialID.toString());
        if (checkCache && checkCache.length > 0) {
            return checkCache;
        }

        var response = http.request(BASE_URL + serialUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        });

        var description = html.parse(response.toString()).root.getElementByClassName("text-block description")[0].getElementByClassName("body")[0].getElementByClassName("body")[0].textContent;
        if (description) {
            plugin.cachePut("SerialsDescriptions", serialID.toString(), description, 604800);
        }

        return description;
    }

    function getSerialList(o, s, t) {
        printDebug("getSerialList(" + o + ", " + s + ", " + t + ")");

        // s: 1=>by rating; 2=>by alphabet; 3=>by date
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'serial',
                'type': 'search',
                'o': o || '0',
                's': s || '1',
                't': t || '0'
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        });

        return showtime.JSONDecode(response.toString()).data;
    }

    function serialInfo(page, serialName, serialID, url) {
        printDebug("serialInfo(" + serialName + ", " + serialID + ", " + url + ")");

        page.metadata.logo = "http://static.lostfilm.tv/Images/" + serialID + "/Posters/poster.jpg";
        page.metadata.title = serialName;
        page.type = "directory";
        page.metadata.glwview = plugin.path + "views/serial.view";
        page.loading = true;

        var response = http.request(BASE_URL + url + "/seasons/", {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        });

        var rootObj = html.parse(response.toString()).root;
        var seasonsList = rootObj.getElementByClassName("serie-block");
        var seasonsMap = [];

        for (var i = 0; i < seasonsList.length; ++i) {
            var seasonEmpty = true;
            var seasonSeries = seasonsList[i].getElementByTagName("tr");
            for (var j = 0; j < seasonSeries.length; ++j) {
                if (seasonSeries[j].attributes.length > 0) {
                    continue;
                } else {
                    seasonEmpty = false;
                    break;
                }
            }

            if (seasonEmpty) {
                continue;
            }

            var seasonName = seasonsList[i].getElementByTagName("h2")[0].textContent;
            seasonsMap.push({name: seasonName, series: seasonSeries});
        }

        if (store.sorting === "asc") {
            seasonsMap.reverse();
        }

        for (var i = 0; i < seasonsMap.length; ++i) {
            var season = seasonsMap[i];
            
            page.appendItem("", "separator", {
                title: season.name
            });

            var seriesList = season.series;
            if (store.sorting === "asc") {
                seriesList.reverse();
            }

            for (var j = 0; j < seriesList.length; ++j) {
                if (seriesList[j].attributes.length > 0) {
                    continue;
                }
                var dataCode = seriesList[j].getElementByClassName(["alpha"])[0].children[0].attributes.getNamedItem("data-code").value;
                var serieDiv = seriesList[j].getElementByClassName(["gamma"])[0].children[0];
                var serieDirtyName = serieDiv.textContent;
                var serieNativeName = serieDiv.getElementByTagName("span")[0].textContent.trim();
                var serieNumber = store.sorting === "asc" ? j : seriesList.length - j;
                var serieName = serieDirtyName.replace(serieNativeName, "").trim() + " (" + serieNativeName + ")";

                page.appendItem(PREFIX + ":torrent:" + serieName + ":" + dataCode, "video", {
                    title: new showtime.RichText("<font color='#b3b3b3'>[" + (serieNumber < 10 ? "0" : "") + serieNumber + "]</font>    " + serieName)
                });
            }
        }

        page.loading = false;
    }

    // ====== auth
    function checkAuthOnce(page) {
        var pageLogin = showtime.httpGet("http://www.lostfilm.tv/v_search.php",
            { 'c': '190', 's': '4', 'e': '22' }, {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }, { noFollow: true });

        if (pageLogin.statuscode == 302 || !store.username) {
            authRequired = true;

            if (!authChecked) {
                authChecked = true;
                var authNow = showtime.message("Login required. Do you want to log in now?", true, true);
                if (authNow) {
                    authRequired = performLogin(page) == false;
                }
            }
        } else {
            authRequired = false;
        }

        authChecked = true;
    }

    function validateEmail(email) {
        return (/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(email));
    }

    function getEmailByLogin(credentials) {
        var response = http.request("http://login1.bogi.ru/login.php?referer=" + BASE_URL, {
            debug: store.enableDebug,
            postdata: {
                'login': credentials.username,
                'password': credentials.password,
                'module': 1,
                'target': BASE_URL,
                'repage': 'user',
                'act': 'login'
            },
            noFollow: true,
            headers: {
                'Upgrade-Insecure-Requests': 1,
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                'Referer': BASE_URL,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': ''
            }
        });

        var email = "";

        var bogiDom = html.parse(response.toString());
        var b_form = bogiDom.root.getElementById("b_form");
        if (!b_form) {
            return email;
        }

        var inputs = b_form.getElementByTagName("input");

        if (!inputs) {
            return email;
        }

        for (var i = 0; i < inputs.length; ++i) {
            var inputName = inputs[i].attributes.getNamedItem("name").value;
            var inputValue = inputs[i].attributes.getNamedItem("value").value;
            if (inputName === "email") {
                email = inputValue;
                break;
            }
        }

        return email;
    }

    function performLogin(page) {
        var credentials = plugin.getAuthCredentials(SYNOPSIS, "Login required.", false);

        if (!credentials || !credentials.username || !credentials.password) {
            // need to ask to credentials first
            credentials = plugin.getAuthCredentials(SYNOPSIS, "Login required.", true);
        }

        if (credentials && credentials.rejected) {
            printDebug("performLogin(): credentials.rejected");
            return false;
        } else if (credentials) {
            var username = credentials.username;

            if (!validateEmail(username)) {
                // old auth method
                printDebug("performLogin(): old auth method");
                username = getEmailByLogin(credentials);
                if (username.length <= 0) {
                    // failed to get email
                    printDebug("performLogin(): old auth method: failed to get email by username");
                    showtime.message("Failed to get email by username. Please use email as username", true, false);
                    return false;
                }
            }

            return performLoginInternal(page, username, credentials.password);
        }

        showtime.message("Ooops. Something went wrong.", true, false);
        return false;
    }

    function performLoginInternal(page, username, password, captcha) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'users',
                'type': 'login',
                'mail': encodeURIComponent(username),
                'pass': password,
                'need_captcha': captcha ? 1 : 0,
                'captcha': captcha || "",
                'rem': 1
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        });

        if (/need_captcha/i.test(response) && !captcha) {
            page.redirect(PREFIX + ":performCaptchaLogin:" + username + ":" + password);
            return false;
        }

        var responseObj = showtime.JSONDecode(response.toString());

        if (!responseObj || !responseObj.success) {
            printDebug("performLogin(): !responseObj || !responseObj.success");
            showtime.message("Login was unsuccessfull, please try again", true, false);
            return false;
        }

        store.username = responseObj.name;
        return saveUserCookie(response.multiheaders);
    }

    function performCaptchaLogin(page, username, password) {
        page.loading = true;

        var rand = Math.random();
        var captchaResponse = http.request(BASE_URL + "simple_captcha.php?" + rand, {debug: store.enableDebug, headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
            'Cookie': ''
        }});
        saveUserCookie(captchaResponse.multiheaders);

        page.type = "directory";
        page.metadata.logo = LOGO;
        page.metadata.title = "Login";
        page.metadata.glwview = plugin.path + "views/captchaLogin.view";
        page.appendPassiveItem("customString", {value: username}, {title: "Login"});
        page.appendPassiveItem("customString", {value: password, password: true}, {title: "Password"});
        page.appendPassiveItem("customImage", undefined, {icon: "http://www.lostfilm.tv/simple_captcha.php?" + rand});
        page.appendPassiveItem("customString", { value: "" }, {title: "Captcha"});
        page.appendAction("Login", function() {
            // yup, thats dirty. i was unable to find a better way of communication btw view and js
            var items = page.getItems();
            var finalUsername = items[0].root.data.value;
            var finalPassword = items[1].root.data.value;
            var captcha = items[3].root.data.value;

            if (performLoginInternal(page, finalUsername, finalPassword, captcha)) {
                page.redirect(PREFIX + ":start");
            } else {
                items[2].root.metadata.icon = "http://www.lostfilm.tv/simple_captcha.php?" + Math.random();
            }
        }, "hello-there");

        page.loading = false;
    }

    function performLogout() {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'users',
                'type': 'logout'
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        });
        store.userCookie = "";
        store.username = undefined;
        authRequired = true;
    }

    function saveUserCookie(headers) {
        if (!headers) {
            return false;
        }

        var cookie = headers["Set-Cookie"];
        var resultCookies = "";

        for (var i = 0; i < cookie.length; ++i) {
            if (cookie[i].indexOf("=deleted") >= 0) {
                continue;
            }
            resultCookies += cookie[i];
        }

        store.userCookie = resultCookies;
        return true;
    }
    // ====== auth END

    function search(page, query) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'common',
                'type': 'search',
                'val': query
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/604.4.7 (KHTML, like Gecko) Version/11.0.2 Safari/604.4.7',
                'Cookie': store.userCookie
            }
        });

        var series = showtime.JSONDecode(response.toString()).data["series"];

        for (var i = 0; i < series.length; ++i) {
            page.appendItem(PREFIX + ":serialInfo:" + series[i].title + ":" + series[i].id + ":" + series[i].link, "video", {
                title: series[i].title,
                description: series[i].title,
                icon: "http://static.lostfilm.tv/Images/" + series[i].id + "/Posters/poster.jpg"
            });
        }

        page.entries = series.length;
    }
})(this);
