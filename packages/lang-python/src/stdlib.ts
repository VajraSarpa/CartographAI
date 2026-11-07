/**
 * Top-level standard-library module names: Python 3.13's
 * sys.stdlib_module_names (public ones), plus modules removed in 3.12/3.13
 * that older code still imports. An import of one of these is external.
 */
export const STDLIB = new Set(
  (
    "__future__ _thread abc antigravity argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 cProfile " +
    "calendar cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib contextvars copy " +
    "copyreg csv ctypes curses dataclasses datetime dbm decimal difflib dis doctest email encodings ensurepip enum errno " +
    "faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib " +
    "grp gzip hashlib heapq hmac html http idlelib imaplib importlib inspect io ipaddress itertools json keyword linecache " +
    "locale logging lzma mailbox marshal math mimetypes mmap modulefinder msvcrt multiprocessing netrc nt ntpath nturl2path " +
    "numbers opcode operator optparse os pathlib pdb pickle pickletools pkgutil platform plistlib poplib posix posixpath pprint " +
    "profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource " +
    "rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 " +
    "sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct subprocess symtable sys sysconfig syslog " +
    "tabnanny tarfile tempfile termios textwrap this threading time timeit tkinter token tokenize tomllib trace traceback " +
    "tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser " +
    "winreg winsound wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo " +
    // removed in 3.12 / 3.13
    "asynchat asyncore distutils imp smtpd aifc audioop cgi cgitb chunk crypt imghdr lib2to3 mailcap msilib nis nntplib " +
    "ossaudiodev pipes sndhdr spwd sunau telnetlib uu xdrlib"
  ).split(" "),
);
