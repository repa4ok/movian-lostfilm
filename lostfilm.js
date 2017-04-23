(function(plugin) {
    var PREFIX = plugin.getDescriptor().id;
    var TITLE = plugin.getDescriptor().title;
    var SYNOPSIS = plugin.getDescriptor().synopsis;
    var LOGO = plugin.path + "logo.png";
    var BASE_URL = "http://www.lostfilm.tv/";

    var service = require("showtime/service");
    var http = require("./http");
    var html = require("showtime/html");

    service.create(TITLE, PREFIX + ":start", "video", true, LOGO);

    var authRequired = true;
    var store = plugin.createStore("config", true);

    var settings = plugin.createSettings(TITLE, LOGO, SYNOPSIS);
    settings.createBool("enableDebug", "Enabled debug output", false, function(v) { store.enableDebug = v });
    settings.createMultiOpt('quality', 'Video quality', [
        ['sd', 'SD'],
        ['hd', 'HD', true],
        ['fhd', 'Full HD']], 
        function(v) {
            printDebug("set quality to " + v);
            store.quality = v;
    });
    settings.createDivider("Categories visibility");
    settings.createBool("showPopular", "Popular", true, function(v) { store.showPopular = v; });
    settings.createBool("showNew", "New", true, function(v) { store.showNew = v; });
    settings.createBool("showFilming", "Filming", true, function(v) { store.showFilming = v; });
    settings.createBool("showFinished", "Finished", true, function(v) { store.showFinished = v; });

    function printDebug(message) {
        if (store.enableDebug) showtime.print(message);
    }

    plugin.search = true;
    plugin.addSearcher(TITLE, LOGO, search)
    plugin.addURI(PREFIX + ":start", start);
    plugin.addURI(PREFIX + ":allSerials:(.*):(.*):(.*)", populateAll);
    plugin.addURI(PREFIX + ":serialInfo:(.*):(.*):(.*)", serialInfo);
    plugin.addURI(PREFIX + ":torrent:(.*):(.*)", function (page, serieName, dataCode) {
        page.loading = true;
        printDebug(PREFIX + ":torrent:" + serieName + ": " + dataCode);

        if (authRequired) {
            var sl = performLogin();
            if (sl.length > 0) {
                page.loading = false;
                page.error(sl);
                return;
            }
        }

        var attributes = dataCode.split('-');
        var c = attributes[0];
        var s = attributes[1];
        var e = attributes[2];
        var response = http.request(BASE_URL + "v_search.php?c=" + c + "&s=" + s + "&e=" + e);
        var torrentsUrl = html.parse(response.toString()).root.getElementByTagName("meta")[0].attributes.getNamedItem("content")["value"].replace("0; url=", "");
        var response = http.request(torrentsUrl)

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
            showtime.print("found torrent " + currentTorrentLabel + ". url = " + currentTorrentLink);

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

        // set watched if it wasn't before
        var watchedSeries = getWatched(attributes[0]);
        if (watchedSeries.indexOf(dataCode) < 0) {
            toggleWatched(dataCode);
        }

        page.loading = false;
        page.source = "videoparams:" + showtime.JSONEncode({
            title: serieName,
            canonicalUrl: PREFIX + ":torrent:" + serieName + ":" + dataCode,
            sources: [{
                url: 'torrent:video:' + desiredUrl
            }]
        });
        page.type = "video";
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
                var sl = performLogin();
                if (sl.length > 0) {
                    page.error(sl);
                    return;
                }
            }

            page.redirect(PREFIX + ":start");
        });

        if (checkCookies()) {
            applyCookies();
            authRequired = false;
        } else {
            authRequired = true;
        }

        populateMainPage(page);
        page.loading = false;
    }

    function checkCookies() {
        return store.userCookie && store.userCookie.length > 0;
    }

    function applyCookies() {
        plugin.addHTTPAuth("http://.*\\.lostfilm\\.tv", function(req) {
            req.setHeader("Cookie", store.userCookie);
            req.setHeader('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0');
        });
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

            if (s !== 2) {
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

        var response = http.request(BASE_URL + serialUrl);
        var description = html.parse(response.toString()).root.getElementByClassName("text-block description")[0].getElementByClassName("body")[0].getElementByClassName("body")[0].textContent;
        plugin.cachePut("SerialsDescriptions", serialID.toString(), description, 604800);
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
            }
        });
        return showtime.JSONDecode(response.toString()).data;
    }

    // not used
    function setFavorite(serialID, enabled) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'serial',
                'type': 'follow',
                'id': serialID
            }
        });
    }

    function toggleWatched(dataCode) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'serial',
                'type': 'markepisode',
                'val': dataCode
            }
        });
    }

    function getWatched(serialID) {
        printDebug("getWatched(" + serialID + ")");
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'serial',
                'type': 'getmarks',
                'id': serialID
            }
        });
        var responseObj = showtime.JSONDecode(response.toString());
        return responseObj.data || [];
    }

    function serialInfo(page, serialName, serialID, url) {
        printDebug("serialInfo(" + serialName + ", " + serialID + ", " + url + ")");
        page.metadata.logo = LOGO;
        page.metadata.title = serialName;
        page.type = "directory";
        page.metadata.glwview = plugin.path + "views/serial.view";
        page.loading = true;

        var response = http.request(BASE_URL + url + "/seasons/");
        var rootObj = html.parse(response.toString()).root;

        // OMG how dirty...
        // postponed due to main page not updated
        /*
        var isFavorite = rootObj.getElementByClassName("favorites-btn").toString().length;
        page.options.createBool(serialID + "_fav", "Favorite", isFavorite, function(v) {
            if (v != isFavorite) {
                setFavorite(serialID, v);
                page.redirect(PREFIX + ":serialInfo:" + serialName + ":" + serialID + ":" + url);
            }
        });
        */

        var seasonsList = rootObj.getElementByClassName("serie-block");
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
            page.appendItem("", "separator", {
                title: seasonName
            })

            for (var j = 0; j < seasonSeries.length; ++j) {
                if (seasonSeries[j].attributes.length > 0) {
                    continue;
                }
                var dataCode = seasonSeries[j].getElementByClassName(["alpha"])[0].children[0].attributes.getNamedItem("data-code").value;
                var serieDiv = seasonSeries[j].getElementByClassName(["gamma"])[0].children[0];
                var serieDirtyName = serieDiv.textContent.trim();
                var serieNativeName = serieDiv.getElementByTagName("span")[0].textContent;
                var serieNumber = seasonSeries.length - j;
                var serieName = serieDirtyName.replace(serieNativeName, "") + " (" + serieNativeName + ")";

                page.appendItem(PREFIX + ":torrent:" + serieName + ":" + dataCode, "video", {
                    title: new showtime.RichText("<font color='#b3b3b3'>[" + (serieNumber < 10 ? "0" : "") + serieNumber + "]</font>    " + serieName)
                });
            }
        }

        page.loading = false;
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

    function performLogin() {
        var credentials = plugin.getAuthCredentials(SYNOPSIS, "Login required.", true);
        if (credentials.rejected) {
            printDebug("performLogin(): credentials.rejected");
            return "Rejected by user"; //rejected by user
        }
        if (credentials) {
            var username = credentials.username;

            if (!validateEmail(username)) {
                // old auth method
                printDebug("performLogin(): old auth method");
                username = getEmailByLogin(credentials);
                if (username.length <= 0) {
                    // failed to get email
                    printDebug("performLogin(): old auth method: failed to get email by username");
                    return "Failed to get email by username. Please use email as username";
                }
            }

            var response = http.request(BASE_URL + "ajaxik.php", {
                debug: store.enableDebug,
                postdata: {
                    'act': 'users',
                    'type': 'login',
                    'mail': username,
                    'pass': credentials.password,
                    'rem': 1
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                    'Cookie': ''
                }
            });

            var responseObj = showtime.JSONDecode(response.toString());

            if (!responseObj || !responseObj.success) {
                printDebug("performLogin(): !responseObj && !responseObj.success");
                return "Login was unsuccessfull, please try again";
            }

            store.username = responseObj.name;

            if (saveUserCookie(response.multiheaders)) {
                applyCookies();
                return "";
            }
        }

        return "Ooops. Something goes wrong.";
    }

    function performLogout() {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'users',
                'type': 'logout'
            }
        });
        store.userCookie = "";
        applyCookies();
        store.username = undefined;
        authRequired = true;
    }

    function saveUserCookie(headers) {
        var cookie;
        if (!headers) return false;
        cookie = headers["Set-Cookie"];
        if (cookie) {
            cookie.join("");
            store.userCookie = cookie;
            return true;
        }
        return false;
    }

    function search(page, query) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: store.enableDebug,
            postdata: {
                'act': 'common',
                'type': 'search',
                'val': query
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
