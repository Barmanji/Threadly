const Loader = () => {
  return (
    <div className="flex space-x-2 w-full h-screen fixed inset-0 bg-cream/80 backdrop-blur-sm z-50 justify-center items-center">
      <div aria-label="Loading..." role="status">
        <svg className="h-12 w-12 animate-spin" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path
            className="fill-ink/15"
            d="M12 5C8.13401 5 5 8.13401 5 12C5 15.866 8.13401 19 12 19C15.866 19 19 15.866 19 12C19 8.13401 15.866 5 12 5Z"
          ></path>
          <path
            className="fill-retro-orange"
            d="M12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 11.4477 20.5523 11 20 11C19.4477 11 19 11.4477 19 12C19 15.866 15.866 19 12 19C8.13401 19 5 15.866 5 12C5 8.13401 8.13401 5 12 5C12.5523 5 13 4.55228 13 4C13 3.44772 12.5523 3 12 3Z"
          ></path>
        </svg>
      </div>
    </div>
  );
};

export default Loader;
