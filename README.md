signTextJS plus
===============

re-implements window.crypto.signText and exposes it to content

Why signTextJS plus?
--------------------
The goal of the original signTextJS is to provide a stop-gap measure for users
while sites migrate away from window.crypto.signText. signTextJS plus is meant
to last longer and enhances the add-on with features such as automatic
signatures and filtering by certificate authority.

How-To
------
Install and activate the Firefox Add-On SDK following the directions
[here](https://developer.mozilla.org/en-US/Add-ons/SDK/Tutorials/Installation).
Then, after checking out this repo, use `jpm run` to run Firefox with the
add-on installed or `jpm xpi` to package the add-on. After the add-on has been
installed, content scripts that call `window.crypto.signText` should "just
work".
Alternatively, download and install a prepackaged xpi
[here](https://addons.mozilla.org/en-US/firefox/addon/signtextjs-plus/).

Corresponding Source
--------------------
You may find the corresponding source at the add-on
[home page](https://github.com/jasp00/signTextJS).

TODO
----
See [issues](https://github.com/jasp00/signTextJS/issues).
