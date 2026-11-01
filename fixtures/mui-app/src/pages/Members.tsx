import { Box, Button, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

export function Members() {
  return (
    <Box sx={{ p: 2, bgcolor: "primary.main", borderRadius: 1 }}>
      <Typography sx={{ fontSize: "13px", color: "#111" }}>회원 목록</Typography>
      <Button startIcon={<AddIcon />}>회원 추가</Button>
    </Box>
  );
}
