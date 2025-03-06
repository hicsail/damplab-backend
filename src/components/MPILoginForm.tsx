import { useEffect, useState } from "react";
import { Box, Button, Avatar, Typography, Menu, MenuItem } from "@mui/material";
import { handleLoginCallback, checkLoginStatus, logout } from "../mpi/SequencesQueries";

interface MPILoginFormProps {
  isLoggedIn: boolean;
  setIsLoggedIn: (value: boolean) => void;
}

interface UserInfo {
  name?: string;
  email?: string;
  picture?: string;
}

export default function MPILoginForm({ isLoggedIn, setIsLoggedIn }: MPILoginFormProps) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  // Check if we're on the callback page
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    
    if (code && url.pathname.includes("/mpi/auth0_redirect")) {
      // Handle the callback
      handleLoginCallback(code).then(() => {
        // Redirect to home page or dashboard after successful login
        window.location.href = "/";
      });
    }
  }, []);

  // Check login status and get user info
  useEffect(() => {
    const checkLogin = async () => {
      const loggedIn = await checkLoginStatus();
      setIsLoggedIn(loggedIn);
      
      if (loggedIn) {
        // Get user info from localStorage or from API
        const storedUserInfo = localStorage.getItem('user_info');
        if (storedUserInfo) {
          setUserInfo(JSON.parse(storedUserInfo));
        } else {
          try {
            const response = await fetch(`${process.env.REACT_APP_BACKEND_MPI}/user-info`, {
              headers: {
                "Authorization": `Bearer ${localStorage.getItem('session_token')}`
              }
            });
            if (response.ok) {
              const data = await response.json();
              setUserInfo(data);
              localStorage.setItem('user_info', JSON.stringify(data));
            }
          } catch (error) {
            console.error('Failed to fetch user info', error);
          }
        }
      }
    };
    
    checkLogin();
  }, [setIsLoggedIn]);

  const handleLogin = () => {
    // Generate a random state parameter for security
    const state = Math.random().toString(36).substring(2);
    localStorage.setItem('auth_state', state);
    
    window.location.href = `https://${process.env.REACT_APP_AUTH0_DOMAIN}/authorize?response_type=code&scope=openid%20profile%20email%20offline_access&client_id=${process.env.REACT_APP_AUTH0_CLIENT_ID}&redirect_uri=${process.env.REACT_APP_REDIRECT_URI}/mpi/auth0_redirect&audience=${process.env.REACT_APP_AUTH0_AUDIENCE}&state=${state}`;
  };

  const handleLogout = async () => {
    await logout();
    localStorage.removeItem('user_info');
    setIsLoggedIn(false);
    setUserInfo(null);
    
    // Redirect to Auth0 logout page
    window.location.href = `https://${process.env.REACT_APP_AUTH0_DOMAIN}/v2/logout?client_id=${process.env.REACT_APP_AUTH0_CLIENT_ID}&returnTo=${encodeURIComponent(process.env.REACT_APP_REDIRECT_URI || '')}`;
  };

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  if (isLoggedIn === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', height: '32px' }}>Loading...</Box>;
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '32px' }}>
      {isLoggedIn ? (
        <>
          <Box 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              '&:hover': { opacity: 0.8 }
            }}
            onClick={handleMenuClick}
          >
            {userInfo?.picture ? (
              <Avatar 
                src={userInfo.picture} 
                alt={userInfo.name || 'User'} 
                sx={{ width: 32, height: 32, marginRight: 1 }}
              />
            ) : (
              <Avatar sx={{ width: 32, height: 32, marginRight: 1 }}>
                {userInfo?.name?.charAt(0) || 'U'}
              </Avatar>
            )}
            <Typography variant="body2" sx={{ marginRight: 1 }}>
              {userInfo?.name || 'User'}
            </Typography>
          </Box>
          <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={handleMenuClose}
            MenuListProps={{
              'aria-labelledby': 'user-menu-button',
            }}
          >
            <MenuItem onClick={handleLogout}>Logout</MenuItem>
          </Menu>
        </>
      ) : (
        <Button onClick={handleLogin} variant='contained' color='primary'>MPI Login</Button>
      )}
    </Box>
  );
} 